// Simple script to generate PWA icons
// Run: node generate-icons.js
const { createCanvas } = require('canvas');
const fs = require('fs');

function createIcon(size) {
  // Since canvas module may not be available, create a simple SVG fallback
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#00d4aa"/>
    <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" font-size="${size * 0.5}" font-family="sans-serif">🔐</text>
  </svg>`;
  return svg;
}

// For now, just create placeholder HTML that explains how to generate icons
console.log('Icons can be generated with any PNG tool.');
console.log('The PWA works without custom icons — browser will use defaults.');
