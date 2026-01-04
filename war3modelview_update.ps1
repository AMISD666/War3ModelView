
Start-Sleep -Seconds 3

# Kill the process if still running
$proc = Get-Process -Name '咕咕war3模型编辑器' -ErrorAction SilentlyContinue
if ($proc) {
    $proc | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Copy new EXE over old EXE
try {
    Copy-Item -Path 'C:\Users\ADMINI~1\AppData\Local\Temp\咕咕war3模型编辑器.exe' -Destination 'D:\Desktop\war3modelview\War3ModelView\src-tauri\target\release\咕咕war3模型编辑器.exe' -Force
    Start-Sleep -Seconds 1
    # Start the updated application
    Start-Process -FilePath 'D:\Desktop\war3modelview\War3ModelView\src-tauri\target\release\咕咕war3模型编辑器.exe'
} catch {
    # If copy failed, show error message
    [System.Windows.Forms.MessageBox]::Show("更新失败: $($_.Exception.Message)", "更新错误", 0, 16)
}

# Clean up - remove the downloaded new EXE
Remove-Item -Path 'C:\Users\ADMINI~1\AppData\Local\Temp\咕咕war3模型编辑器.exe' -Force -ErrorAction SilentlyContinue
