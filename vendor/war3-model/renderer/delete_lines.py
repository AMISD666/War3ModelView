import sys

file_path = "D:/Desktop/war3modelview/War3ModelView/node_modules/war3-model/renderer/modelRenderer.ts"
start_line = 1338
end_line = 1472

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# lines are 0-indexed in python
# Delete from start_line-1 up to end_line (exclusive in slice, but I want to include end_line)
# So slice is [start_line-1 : end_line]
# e.g. delete line 1 (index 0). slice [0:1].
# delete 1338 to 1472. slice [1337:1472].
# lines[1337] is line 1338.
# lines[1471] is line 1472.
# slice [1337:1472] includes 1337 up to 1471. Correct.

del lines[start_line-1 : end_line]

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(lines)
