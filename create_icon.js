const fs = require('fs');
const path = require('path');

// A simple 1x1 red PNG
const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const buffer = Buffer.from(base64Png, 'base64');

const iconPath = path.join(__dirname, 'resources', 'icon.png');
fs.writeFileSync(iconPath, buffer);
console.log(`Icon created successfully at ${iconPath}`);
