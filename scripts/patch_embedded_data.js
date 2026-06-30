'use strict';
/**
 * patch_embedded_data.js
 * Replaces the embedded JSON blocks in index.html with current data files.
 * Run: node scripts/patch_embedded_data.js
 */
var fs   = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var htmlPath = path.join(root, 'index.html');

var html = fs.readFileSync(htmlPath, 'utf8');

function compact(data) { return JSON.stringify(data); }

function replaceBlock(src, id, newContent) {
  // Matches: <script type="application/json" id="ID">...content...</script>
  var re = new RegExp(
    '(<script[^>]+id="' + id + '"[^>]*>)([\\s\\S]*?)(</script>)',
    'g'
  );
  var count = 0;
  var result = src.replace(re, function(_, open, _old, close) {
    count++;
    return open + newContent + close;
  });
  if (count === 0) throw new Error('Block not found: ' + id);
  if (count > 1)  throw new Error('Multiple blocks found for: ' + id);
  console.log('✅ Updated #' + id + ' (' + newContent.length + ' bytes)');
  return result;
}

function addBlockAfter(src, afterId, newId, newContent) {
  // Insert a new <script> block right after the closing </script> of afterId
  var re = new RegExp(
    '(<script[^>]+id="' + afterId + '"[^>]*>[\\s\\S]*?</script>)'
  );
  if (src.includes('id="' + newId + '"')) {
    // Already exists — replace it
    return replaceBlock(src, newId, newContent);
  }
  var result = src.replace(re, function(match) {
    return match + '\n    <script type="application/json" id="' + newId + '">' + newContent + '</script>';
  });
  console.log('✅ Inserted #' + newId + ' (' + newContent.length + ' bytes)');
  return result;
}

// Load the updated JSON files
var participants = require('../data/yossiCup/participants.json');
var r1Bracket   = require('../data/yossiCup/round1Bracket.json');
var r2Bracket   = require('../data/yossiCup/round2Bracket.json');
var rounds      = require('../data/yossiCup/cupRounds.json');
var r3BracketPath = path.join(root, 'data', 'yossiCup', 'round3Bracket.json');
var r3Bracket   = fs.existsSync(r3BracketPath) ? JSON.parse(fs.readFileSync(r3BracketPath, 'utf8')) : null;
var r4BracketPath = path.join(root, 'data', 'yossiCup', 'round4Bracket.json');
var r4Bracket   = fs.existsSync(r4BracketPath) ? JSON.parse(fs.readFileSync(r4BracketPath, 'utf8')) : null;

// Replace existing blocks
html = replaceBlock(html, 'ycParticipants', compact(participants));
html = replaceBlock(html, 'ycBracket',      compact(r1Bracket));   // keep as R1 for backward compat
html = replaceBlock(html, 'ycRounds',       compact(rounds));

// Add/update R2 bracket block
html = addBlockAfter(html, 'ycBracket', 'ycBracketR2', compact(r2Bracket));

// Add/update R3 bracket block
if (r3Bracket) {
  html = addBlockAfter(html, 'ycBracketR2', 'ycBracketR3', compact(r3Bracket));
}

// Add/update R4 bracket block
if (r4Bracket) {
  html = addBlockAfter(html, 'ycBracketR3', 'ycBracketR4', compact(r4Bracket));
}

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('\n✅ index.html patched successfully.');
