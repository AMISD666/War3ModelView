import React from 'react'
import ReactDOM from 'react-dom/client'
import 'antd/dist/reset.css'
import App from './App'
import './assets/index.css'
import { parseMDX } from 'war3-model'

// Suppress specific debug logs in production
const suppressedPrefixes = ['[Particles]', '[initShaders]', '[ModelRenderer]'];
const originalLog = console.log;
const originalWarn = console.warn;

console.log = (...args: any[]) => {
    if (typeof args[0] === 'string' && suppressedPrefixes.some(p => args[0].startsWith(p))) {
        return;
    }
    originalLog(...args);
};

console.warn = (...args: any[]) => {
    if (typeof args[0] === 'string' && suppressedPrefixes.some(p => args[0].startsWith(p))) {
        return;
    }
    originalWarn(...args);
};

console.log('war3-model loaded:', parseMDX)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <App />
)
