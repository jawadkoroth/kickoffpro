const fs = require('fs');
const path = require('path');

function processDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      processDir(fullPath);
    } else if (/\.(ts|tsx|css|json|md)$/.test(entry.name)) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let modified = false;
      
      if (content.includes('NOIR')) {
        content = content.replace(/NOIR/g, 'KickoffPro');
        modified = true;
      }
      if (content.includes('Noir')) {
        content = content.replace(/Noir/g, 'KickoffPro');
        modified = true;
      }
      if (/noir/g.test(content)) {
        // Do not replace hyphenated noir like noir-store, noir-toast, etc if we want to be safe, 
        // but the prompt asked to replace ALL references to remove NOIR classes etc.
        // Wait, "noir-" is used for CSS classes. So we SHOULD replace "noir" with "kickoffpro" globally.
        content = content.replace(/noir/g, 'kickoffpro');
        modified = true;
      }
      
      if (modified) {
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }
  }
}

processDir(path.join(__dirname, 'src'));
processDir(path.join(__dirname, 'supabase'));
// Also replace in README and scripts
processDir(path.join(__dirname, 'scripts'));
