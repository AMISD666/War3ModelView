# 如何构建便携版 (Portable) 程序

按照以下步骤生成可以直接运行的文件夹：

1.  **打开终端 (Terminal)**
    确保你处于项目根目录：
    `d:\Desktop\war3modelview\war3-model-editor`

2.  **构建项目代码**
    运行以下命令来编译 React 和 TypeScript 代码：
    ```bash
    npm run build
    ```
    等待命令完成，确保没有报错。

3.  **生成可执行文件 (解压版)**
    运行以下命令来打包程序（仅生成文件夹，不生成安装包）：
    ```bash
    npx electron-builder --win --dir
    ```
    *注意：第一次运行可能需要下载 Electron 二进制文件，如果网络不好可能会慢，请耐心等待。*

4.  **获取结果**
    打包完成后，打开目录：
    `d:\Desktop\war3modelview\war3-model-editor\dist\win-unpacked`

    这个文件夹里包含 `War3 Model Editor.exe` 以及所有依赖文件。

5.  **分享**
    你可以直接将 `win-unpacked` 文件夹重命名（例如 `War3ModelEditor`），然后压缩成 `.zip` 或 `.7z` 发送给其他人。他们解压后直接运行里面的 `.exe` 即可。
