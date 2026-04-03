/**
 * 一次性脚本：从源码中移除 console.log/debug/info/warn/trace/time/timeEnd（保留 console.error）
 */
import fs from 'fs'
import path from 'path'
import ts from 'typescript'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const STRIP_METHODS = new Set(['log', 'debug', 'info', 'warn', 'trace', 'time', 'timeEnd'])

function isStripConsoleCall(expr) {
  if (!ts.isCallExpression(expr)) return false
  const fn = expr.expression
  if (!ts.isPropertyAccessExpression(fn)) return false
  if (!ts.isIdentifier(fn.expression) || fn.expression.escapedText !== 'console') return false
  if (!ts.isIdentifier(fn.name)) return false
  return STRIP_METHODS.has(fn.name.escapedText)
}

function shouldDropExpressionStatement(st) {
  return ts.isExpressionStatement(st) && isStripConsoleCall(st.expression)
}

/** @param {ts.Statement[]} list */
function cleanStatementList(list) {
  const out = []
  for (const st of list) {
    const c = cleanStatement(st)
    if (c !== undefined) out.push(c)
  }
  return out
}

/** 剥开括号，便于识别 () => ({ ... }) 中的对象字面量 */
function unwrapExpression(ex) {
  let e = ex
  while (ts.isParenthesizedExpression(e)) {
    e = e.expression
  }
  return e
}

/** 清理对象字面量（含 Zustand create 返回的 store 方法体） */
function cleanObjectLiteralExpression(o) {
  const props = o.properties
    .map((p) => {
      if (ts.isPropertyAssignment(p) && p.initializer) {
        const init = cleanExpression(p.initializer)
        return ts.factory.updatePropertyAssignment(p, p.name, init ?? p.initializer)
      }
      if (ts.isShorthandPropertyAssignment(p) && p.objectAssignmentInitializer) {
        const init = cleanExpression(p.objectAssignmentInitializer)
        return ts.factory.updateShorthandPropertyAssignment(p, p.name, init ?? p.objectAssignmentInitializer)
      }
      if (ts.isMethodDeclaration(p) && p.body) {
        const body = cleanClause(p.body)
        if (body === undefined) return undefined
        return ts.factory.updateMethodDeclaration(
          p,
          p.modifiers,
          p.asteriskToken,
          p.name,
          p.questionToken,
          p.typeParameters,
          p.parameters,
          p.type,
          body
        )
      }
      if (ts.isSpreadAssignment(p)) {
        const expr = cleanExpression(p.expression)
        return ts.factory.updateSpreadAssignment(p, expr ?? p.expression)
      }
      return p
    })
    .filter((p) => p !== undefined)
  return ts.factory.updateObjectLiteralExpression(o, props)
}

/** JSX 属性/子表达式中的 { ... } */
function cleanJsxExpressionNode(ex) {
  if (ts.isJsxExpression(ex)) {
    if (!ex.expression) return ex
    const inner = cleanExpression(ex.expression)
    return ts.factory.updateJsxExpression(ex, inner ?? ex.expression)
  }
  return ex
}

function cleanJsxAttributes(attrs) {
  if (!attrs || typeof attrs.map !== 'function') {
    return attrs
  }
  return attrs.map((attr) => {
    if (!ts.isJsxAttribute(attr)) return attr
    const init = attr.initializer
    if (!init) return attr
    if (ts.isJsxExpression(init)) {
      return ts.factory.updateJsxAttribute(attr, attr.name, cleanJsxExpressionNode(init))
    }
    return attr
  })
}

/** 递归清理 JSX 树中的箭头回调与 console */
function cleanJsxElementLike(ex) {
  if (ts.isJsxSelfClosingElement(ex)) {
    return ts.factory.updateJsxSelfClosingElement(ex, ex.tagName, ex.typeArguments, cleanJsxAttributes(ex.attributes))
  }
  if (ts.isJsxElement(ex)) {
    const op = ts.isJsxOpeningElement(ex.openingElement)
      ? ts.factory.updateJsxOpeningElement(
          ex.openingElement,
          ex.openingElement.tagName,
          ex.openingElement.typeArguments,
          cleanJsxAttributes(ex.openingElement.attributes)
        )
      : ex.openingElement
    const children = ex.children.map((ch) => {
      if (ts.isJsxExpression(ch)) return cleanJsxExpressionNode(ch)
      if (ts.isJsxElement(ch)) return cleanJsxElementLike(ch)
      return ch
    })
    return ts.factory.updateJsxElement(ex, op, children, ex.closingElement)
  }
  if (ts.isJsxFragment(ex)) {
    const ch = ex.children.map((c) => {
      if (ts.isJsxExpression(c)) return cleanJsxExpressionNode(c)
      if (ts.isJsxElement(c)) return cleanJsxElementLike(c)
      return c
    })
    return ts.factory.updateJsxFragment(ex, ex.openingFragment, ch, ex.closingFragment)
  }
  return ex
}

/** 清理函数/箭头函数表达式体中的 console；含 forEach(()=>{}) 等 CallExpression 实参 */
function cleanExpression(ex) {
  if (!ex) return undefined
  if (ts.isParenthesizedExpression(ex)) {
    const inner = cleanExpression(ex.expression)
    return inner !== undefined ? ts.factory.updateParenthesizedExpression(ex, inner) : ex
  }
  if (ts.isAwaitExpression(ex)) {
    const inner = cleanExpression(ex.expression)
    return ts.factory.updateAwaitExpression(ex, inner ?? ex.expression)
  }
  if (ts.isCallExpression(ex)) {
    const callee = ts.isExpression(ex.expression) ? cleanExpression(ex.expression) ?? ex.expression : ex.expression
    const args = ex.arguments.map((arg) => {
      if (ts.isSpreadElement(arg)) {
        const inner = cleanExpression(arg.expression)
        return inner !== undefined ? ts.factory.updateSpreadElement(arg, inner) : arg
      }
      const c = cleanExpression(arg)
      return c !== undefined ? c : arg
    })
    return ts.factory.updateCallExpression(ex, callee, ex.questionDotToken, args)
  }
  if (ts.isObjectLiteralExpression(ex)) {
    return cleanObjectLiteralExpression(ex)
  }
  if (ts.isJsxElement(ex) || ts.isJsxSelfClosingElement(ex) || ts.isJsxFragment(ex)) {
    return cleanJsxElementLike(ex)
  }
  if (ts.isJsxExpression(ex)) {
    return cleanJsxExpressionNode(ex)
  }
  if (ts.isArrowFunction(ex)) {
    const rawBody = unwrapExpression(ex.body)
    if (ts.isBlock(rawBody)) {
      const b = cleanBlock(rawBody)
      if (b === undefined) {
        return ts.factory.updateArrowFunction(ex, ex.modifiers, ex.typeParameters, ex.parameters, ex.type, ex.equalsGreaterThanToken, ts.factory.createBlock([]))
      }
      return ts.factory.updateArrowFunction(ex, ex.modifiers, ex.typeParameters, ex.parameters, ex.type, ex.equalsGreaterThanToken, b)
    }
    if (ts.isObjectLiteralExpression(rawBody)) {
      const obj = cleanObjectLiteralExpression(rawBody)
      const newBody = ts.isParenthesizedExpression(ex.body)
        ? ts.factory.updateParenthesizedExpression(ex.body, obj)
        : obj
      return ts.factory.updateArrowFunction(ex, ex.modifiers, ex.typeParameters, ex.parameters, ex.type, ex.equalsGreaterThanToken, newBody)
    }
    if (ts.isJsxElement(rawBody) || ts.isJsxSelfClosingElement(rawBody) || ts.isJsxFragment(rawBody)) {
      const jsx = cleanJsxElementLike(rawBody)
      const newBody = ts.isParenthesizedExpression(ex.body)
        ? ts.factory.updateParenthesizedExpression(ex.body, jsx)
        : jsx
      return ts.factory.updateArrowFunction(ex, ex.modifiers, ex.typeParameters, ex.parameters, ex.type, ex.equalsGreaterThanToken, newBody)
    }
    if (ts.isCallExpression(rawBody)) {
      if (isStripConsoleCall(rawBody)) {
        return ts.factory.updateArrowFunction(ex, ex.modifiers, ex.typeParameters, ex.parameters, ex.type, ex.equalsGreaterThanToken, ts.factory.createBlock([]))
      }
      const c = cleanExpression(rawBody)
      const newInner = c ?? rawBody
      const newBody = ts.isParenthesizedExpression(ex.body) ? ts.factory.updateParenthesizedExpression(ex.body, newInner) : newInner
      return ts.factory.updateArrowFunction(ex, ex.modifiers, ex.typeParameters, ex.parameters, ex.type, ex.equalsGreaterThanToken, newBody)
    }
    return ex
  }
  if (ts.isFunctionExpression(ex)) {
    const body = cleanClause(ex.body)
    if (body === undefined) return undefined
    return ts.factory.updateFunctionExpression(ex, ex.modifiers, ex.asteriskToken, ex.name, ex.typeParameters, ex.parameters, ex.type, body)
  }
  return ex
}

/** @param {ts.ClassElement} el */
function cleanClassElement(el) {
  if (ts.isMethodDeclaration(el) && el.body) {
    const body = cleanClause(el.body)
    if (body === undefined) return undefined
    return ts.factory.updateMethodDeclaration(el, el.modifiers, el.asteriskToken, el.name, el.questionToken, el.typeParameters, el.parameters, el.type, body)
  }
  if (ts.isConstructorDeclaration(el) && el.body) {
    const body = cleanClause(el.body)
    if (body === undefined) return undefined
    return ts.factory.updateConstructorDeclaration(el, el.modifiers, el.parameters, body)
  }
  if (ts.isGetAccessorDeclaration(el) && el.body) {
    const body = cleanClause(el.body)
    if (body === undefined) return undefined
    return ts.factory.updateGetAccessorDeclaration(el, el.modifiers, el.name, el.parameters, el.type, body)
  }
  if (ts.isSetAccessorDeclaration(el) && el.body) {
    const body = cleanClause(el.body)
    if (body === undefined) return undefined
    return ts.factory.updateSetAccessorDeclaration(el, el.modifiers, el.name, el.parameters, body)
  }
  return el
}

/** @param {ts.Statement} st @returns {ts.Statement | undefined} */
function cleanStatement(st) {
  if (ts.isExpressionStatement(st)) {
    if (shouldDropExpressionStatement(st)) return undefined
    const e = cleanExpression(st.expression)
    return ts.factory.updateExpressionStatement(st, e)
  }

  if (ts.isFunctionDeclaration(st)) {
    const body = cleanClause(st.body)
    if (body === undefined) return undefined
    return ts.factory.updateFunctionDeclaration(st, st.modifiers, st.asteriskToken, st.name, st.typeParameters, st.parameters, st.type, body)
  }

  if (ts.isVariableStatement(st)) {
    const decls = st.declarationList.declarations.map((d) => {
      if (!d.initializer) return d
      const init = cleanExpression(d.initializer)
      return ts.factory.updateVariableDeclaration(d, d.name, d.exclamationToken, d.type, init)
    })
    return ts.factory.updateVariableStatement(
      st,
      st.modifiers,
      ts.factory.updateVariableDeclarationList(st.declarationList, decls)
    )
  }

  if (ts.isReturnStatement(st)) {
    if (st.expression && isStripConsoleCall(st.expression)) return undefined
    if (st.expression) {
      const e = cleanExpression(st.expression)
      return ts.factory.updateReturnStatement(st, e)
    }
    return st
  }

  if (ts.isClassDeclaration(st)) {
    const members = st.members.map(cleanClassElement).filter((m) => m !== undefined)
    return ts.factory.updateClassDeclaration(st, st.modifiers, st.name, st.typeParameters, st.heritageClauses, members)
  }

  if (ts.isDoStatement(st)) {
    const body = cleanClause(st.statement)
    if (body === undefined) return undefined
    return ts.factory.updateDoStatement(st, body, st.expression)
  }

  if (ts.isIfStatement(st)) {
    const th = cleanClause(st.thenStatement)
    const el = st.elseStatement ? cleanClause(st.elseStatement) : undefined
    if (th === undefined && el === undefined) return undefined
    if (th === undefined && el !== undefined) {
      return ts.factory.createIfStatement(ts.factory.createLogicalNot(st.expression), el, undefined)
    }
    if (th !== undefined && el === undefined) {
      return ts.factory.updateIfStatement(st, st.expression, th, undefined)
    }
    return ts.factory.updateIfStatement(st, st.expression, th, el)
  }

  if (ts.isWhileStatement(st)) {
    const body = cleanClause(st.statement)
    if (body === undefined) return undefined
    return ts.factory.updateWhileStatement(st, st.expression, body)
  }

  if (ts.isWithStatement(st)) {
    const body = cleanClause(st.statement)
    if (body === undefined) return undefined
    return ts.factory.updateWithStatement(st, st.expression, body)
  }

  if (ts.isForStatement(st)) {
    const body = cleanClause(st.statement)
    if (body === undefined) return undefined
    return ts.factory.updateForStatement(st, st.initializer, st.condition, st.incrementor, body)
  }

  if (ts.isForInStatement(st)) {
    const body = cleanClause(st.statement)
    if (body === undefined) return undefined
    return ts.factory.updateForInStatement(st, st.initializer, st.expression, body)
  }

  if (ts.isForOfStatement(st)) {
    const body = cleanClause(st.statement)
    if (body === undefined) return undefined
    return ts.factory.updateForOfStatement(st, st.awaitModifier, st.initializer, st.expression, body)
  }

  if (ts.isLabeledStatement(st)) {
    const inner = cleanStatement(st.statement)
    if (inner === undefined) return undefined
    return ts.factory.updateLabeledStatement(st, st.label, inner)
  }

  if (ts.isSwitchStatement(st)) {
    const clauses = []
    for (const cl of st.caseBlock.clauses) {
      if (ts.isCaseClause(cl)) {
        const stmts = cleanStatementList(cl.statements)
        if (stmts.length === 0) continue
        clauses.push(ts.factory.updateCaseClause(cl, cl.expression, stmts))
      } else {
        const stmts = cleanStatementList(cl.statements)
        if (stmts.length === 0) continue
        clauses.push(ts.factory.updateDefaultClause(cl, stmts))
      }
    }
    if (clauses.length === 0) return undefined
    return ts.factory.updateSwitchStatement(st, st.expression, ts.factory.createCaseBlock(clauses))
  }

  if (ts.isTryStatement(st)) {
    const tryBlock = cleanBlock(st.tryBlock)
    if (tryBlock === undefined) return undefined
    let catchClause = undefined
    if (st.catchClause) {
      const cb = cleanBlock(st.catchClause.block)
      catchClause = ts.factory.updateCatchClause(
        st.catchClause,
        st.catchClause.variableDeclaration,
        cb ?? ts.factory.createBlock([])
      )
    }
    let fin = undefined
    if (st.finallyBlock) {
      fin = cleanBlock(st.finallyBlock)
    }
    return ts.factory.updateTryStatement(st, tryBlock, catchClause, fin)
  }

  return st
}

/** @param {ts.Statement} stmt */
function cleanClause(stmt) {
  if (ts.isBlock(stmt)) return cleanBlock(stmt)
  return cleanStatement(stmt)
}

/** @param {ts.Block} block */
function cleanBlock(block) {
  const stmts = cleanStatementList(block.statements)
  if (stmts.length === 0) return undefined
  return ts.factory.updateBlock(block, stmts)
}

/**
 * @param {ts.TransformationContext} context
 * @returns {ts.Transformer<ts.SourceFile>}
 */
function createStripTransformer(context) {
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isSourceFile(node)) {
      const stmts = cleanStatementList(node.statements)
      return ts.factory.updateSourceFile(node, stmts, node.isDeclarationFile, node.referencedFiles, node.typeReferenceDirectives, node.hasNoDefaultLib, node.libReferenceDirectives)
    }
    if (ts.isBlock(node)) {
      const stmts = cleanStatementList(node.statements)
      return ts.factory.updateBlock(node, stmts)
    }
    if (ts.isModuleBlock(node)) {
      const stmts = cleanStatementList(node.statements)
      return ts.factory.updateModuleBlock(node, stmts)
    }
    if (ts.isCaseClause(node)) {
      const stmts = cleanStatementList(node.statements)
      return ts.factory.updateCaseClause(node, node.expression, stmts)
    }
    if (ts.isDefaultClause(node)) {
      const stmts = cleanStatementList(node.statements)
      return ts.factory.updateDefaultClause(node, stmts)
    }
    return ts.visitEachChild(node, visit, context)
  }
  return visit
}

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'out') continue
      walk(p, acc)
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) {
      acc.push(p)
    }
  }
}

const roots = [path.join(ROOT, 'src', 'renderer', 'src'), path.join(ROOT, 'vendor', 'war3-model')]

const files = []
for (const r of roots) {
  if (fs.existsSync(r)) walk(r, files)
}

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false })

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const result = ts.transform(sf, [createStripTransformer])
  const out = result.transformed[0]
  result.dispose()
  const newText = printer.printFile(out)
  if (newText !== text) {
    fs.writeFileSync(file, newText, 'utf8')
    console.log('stripped:', path.relative(ROOT, file))
  }
}
