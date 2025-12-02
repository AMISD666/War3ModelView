$source = "d:\Desktop\war3modelview\war3-model-editor"
$dest = "d:\Desktop\war3modelview\war3-model-editor-export"

# Create destination
if (Test-Path $dest) {
    Remove-Item -Path $dest -Recurse -Force
}
New-Item -ItemType Directory -Path $dest | Out-Null

Write-Host "Backing up to $dest..."

# Function to copy file
function Copy-File($name) {
    if (Test-Path "$source\$name") {
        Copy-Item "$source\$name" "$dest\$name"
        Write-Host "Copied $name"
    }
}

# Function to copy directory with exclusions
function Copy-Dir($name, $exclude) {
    if (Test-Path "$source\$name") {
        $destPath = "$dest\$name"
        New-Item -ItemType Directory -Path $destPath -Force | Out-Null
        
        if ($exclude) {
            Copy-Item "$source\$name\*" "$destPath" -Recurse -Exclude $exclude
        } else {
            Copy-Item "$source\$name\*" "$destPath" -Recurse
        }
        Write-Host "Copied directory $name"
    }
}

# Copy root config files
Copy-File "package.json"
Copy-File "package-lock.json"
Copy-File "tsconfig.json"
Copy-File "tsconfig.node.json"
Copy-File "tsconfig.web.json"
Copy-File "vite.config.ts"
Copy-File "electron.vite.config.ts"
Copy-File "BUILD_INSTRUCTIONS.md"
Copy-File "task.md"
Copy-File "ai_handover.md"

# Copy source directories
Copy-Dir "src" $null
Copy-Dir "public" $null
Copy-Dir "resources" $null

# Copy src-tauri but exclude target
Write-Host "Copying src-tauri (excluding target)..."
$tauriDest = "$dest\src-tauri"
New-Item -ItemType Directory -Path $tauriDest -Force | Out-Null
Get-ChildItem "$source\src-tauri" -Exclude "target" | Copy-Item -Destination $tauriDest -Recurse

Write-Host "Backup complete!"
