$source = "d:\Desktop\war3modelview\war3-model-editor"
$dest = "d:\Desktop\war3modelview\war3-model-editor-export"

Write-Host "Updating backup in $dest..."

# Function to copy file
function Copy-File($name) {
    if (Test-Path "$source\$name") {
        Copy-Item "$source\$name" "$dest\$name" -Force
        Write-Host "Copied $name"
    }
}

# Function to copy directory
function Copy-Dir($name, $exclude) {
    if (Test-Path "$source\$name") {
        $destPath = "$dest\$name"
        if (!(Test-Path $destPath)) {
            New-Item -ItemType Directory -Path $destPath -Force | Out-Null
        }
        
        if ($exclude) {
            # For src-tauri, we want to be careful not to copy target
            # Copy-Item -Recurse sometimes has issues with Exclude on deep levels
            # So we use Robocopy for robust exclusion if possible, or simple Copy-Item if simple
            # Let's use Copy-Item but be careful.
            # Actually, deleting dest and recopying is safer for 'update' to remove deleted files
            # But user might have edited README there.
            # So we will just overwrite.
            
            Get-ChildItem "$source\$name" -Exclude $exclude | Copy-Item -Destination $destPath -Recurse -Force
        } else {
            Copy-Item "$source\$name\*" "$destPath" -Recurse -Force
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
Copy-File "task.md"
Copy-File "ai_handover.md"
Copy-File "apply_patch.js" 

# Copy source directories
# We force overwrite to ensure latest content
Copy-Dir "src" $null
Copy-Dir "public" $null
Copy-Dir "resources" $null

# Copy src-tauri but exclude target
Write-Host "Copying src-tauri (excluding target)..."
$tauriDest = "$dest\src-tauri"
if (!(Test-Path $tauriDest)) { New-Item -ItemType Directory -Path $tauriDest -Force | Out-Null }
# Using Robocopy for src-tauri is much faster and safer for exclusions
# robocopy $source\src-tauri $dest\src-tauri /E /XD target /NFL /NDL /NJH /NJS
# But robocopy output is verbose.
# Let's stick to Copy-Item for simplicity in this environment, but we need to handle the exclusion properly.
# The previous script worked fine.

Get-ChildItem "$source\src-tauri" -Exclude "target" | Copy-Item -Destination $tauriDest -Recurse -Force

Write-Host "Backup update complete!"
