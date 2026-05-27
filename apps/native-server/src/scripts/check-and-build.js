#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Check if dist directory exists
const distPath = path.join(__dirname, '..', '..', 'dist');

if (!fs.existsSync(distPath)) {
  console.log('📦 dist directory not found, building project...');
  try {
    execSync('npm run build', { stdio: 'inherit', cwd: path.join(__dirname, '..', '..') });
    console.log('✅ Build completed successfully');
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
} else {
  console.log('✅ dist directory exists, skipping build');
}
