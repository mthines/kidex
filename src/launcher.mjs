// kidex app: a Mac app for the Dock and the Desktop that opens a terminal
// running Kidex on one project, so kids can start it with a click.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// A project without --color gets one of these, picked by its name, so two apps look different.
const COLORS = ['#f4a641', '#5fc8d6', '#8fc493', '#e06c75', '#6f9be0', '#c792ea'];

export const colorFor = name => COLORS[[...name].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7) % COLORS.length];

const sh = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const as = s => `"${String(s).replace(/[\\"]/g, '\\$&')}"`;

/** The shell line the terminal runs. The window closes when Kidex quits, and stays open if it fails. */
export function shellLine({ cwd, command }) {
  return `cd ${sh(cwd)} && ${command ?? 'kidex .'} && exit`;
}

/** AppleScript that opens one terminal window running Kidex in the user's own shell, so PATH is set up. */
export function appleScript({ cwd, command, terminal, shell = process.env.SHELL || '/bin/zsh' }) {
  if (terminal === 'kitty') {
    // kitty has no AppleScript: start a new kitty running a login shell; if Kidex fails, a shell stays to show why.
    const run = `${command ?? 'kidex .'} || exec ${sh(shell)} -l`;
    return `do shell script ${as(`open -na kitty --args --directory ${sh(cwd)} ${sh(shell)} -lic ${sh(run)}`)}`;
  }
  const line = shellLine({ cwd, command });
  if (terminal === 'iTerm') {
    return `tell application "iTerm"
  if it is running then
    create window with default profile
  else
    activate
    repeat until (count of windows) > 0
      delay 0.1
    end repeat
  end if
  activate
  tell current session of current window to write text ${as(line)}
end tell`;
  }
  return `tell application "Terminal"
  if it is running then
    do script ${as(line)}
  else
    activate
    repeat until (count of windows) > 0
      delay 0.1
    end repeat
    do script ${as(line)} in window 1
  end if
  activate
end tell`;
}

/** "Minecraft" → "Minecraft (Kidex)", so the Dock tells it apart from the game itself. */
export const appName = name => (/\(Kidex\)$/.test(name) ? name : `${name} (Kidex)`).replace(/[/:]/g, '-');

export const defaultTerminal = () => ['kitty', 'iTerm'].find(t => fs.existsSync(`/Applications/${t}.app`)) ?? 'Terminal';

// Draws the icon: a dark rounded tile with a speech bubble in the project's color and the letter or emoji.
// With another app (like the game the project mods), the tile holds that app's icon with KIDEX under it.
const ICON_SWIFT = String.raw`
import AppKit
let a = CommandLine.arguments
let label = a[2]
// The app's own .icns when it has one: the Finder icon can still be a dashed placeholder at the big sizes.
func appIcon(_ path: String) -> NSImage {
  if let b = Bundle(path: path), let name = b.infoDictionary?["CFBundleIconFile"] as? String,
     let file = b.path(forResource: name.hasSuffix(".icns") ? String(name.dropLast(5)) : name, ofType: "icns"),
     let img = NSImage(contentsOfFile: file) { return img }
  return NSWorkspace.shared.icon(forFile: path)
}
let other = a.count > 4 ? appIcon(a[4]) : nil
func hex(_ s: String) -> NSColor {
  var v: UInt64 = 0; Scanner(string: s.replacingOccurrences(of: "#", with: "")).scanHexInt64(&v)
  return NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
}
let color = hex(a[3])
func text(_ t: String, size: CGFloat, color: NSColor, centerX: CGFloat, centerY: CGFloat, kern: CGFloat = 0) {
  let s = NSAttributedString(string: t, attributes: [.font: NSFont.systemFont(ofSize: size, weight: .black), .foregroundColor: color, .kern: kern])
  let b = s.size()
  s.draw(at: NSPoint(x: centerX - b.width / 2, y: centerY - b.height / 2))
}
for size in [16, 32, 128, 256, 512] {
  for scale in [1, 2] {
    let s = CGFloat(size * scale)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(s), pixelsHigh: Int(s), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current!.imageInterpolation = .high
    let u = s / 1024
    let tile = NSBezierPath(roundedRect: NSRect(x: 100 * u, y: 100 * u, width: 824 * u, height: 824 * u), xRadius: 185 * u, yRadius: 185 * u)
    NSGradient(starting: NSColor(srgbRed: 0.17, green: 0.19, blue: 0.26, alpha: 1), ending: NSColor(srgbRed: 0.07, green: 0.08, blue: 0.10, alpha: 1))!.draw(in: tile, angle: -45)
    if let other {
      if s < 64 {
        other.draw(in: NSRect(x: 160 * u, y: 160 * u, width: 704 * u, height: 704 * u)) // too small to read KIDEX
      } else {
        // The app's art on a tile of its own inside Kidex's: some .icns files are only the art, without a tile.
        let inner = NSBezierPath(roundedRect: NSRect(x: 222 * u, y: 300 * u, width: 580 * u, height: 580 * u), xRadius: 130 * u, yRadius: 130 * u)
        NSGradient(starting: NSColor(white: 0.20, alpha: 1), ending: NSColor(white: 0.08, alpha: 1))!.draw(in: inner, angle: -90)
        NSGraphicsContext.saveGraphicsState()
        inner.addClip()
        other.draw(in: NSRect(x: 262 * u, y: 340 * u, width: 500 * u, height: 500 * u))
        NSGraphicsContext.restoreGraphicsState()
        text("KIDEX", size: 150 * u, color: color, centerX: 512 * u, centerY: 215 * u, kern: 12 * u)
      }
    } else {
      let bubble = NSBezierPath(roundedRect: NSRect(x: 200 * u, y: 344 * u, width: 624 * u, height: 430 * u), xRadius: 90 * u, yRadius: 90 * u)
      bubble.move(to: NSPoint(x: 364 * u, y: 350 * u)); bubble.line(to: NSPoint(x: 364 * u, y: 244 * u)); bubble.line(to: NSPoint(x: 484 * u, y: 350 * u)); bubble.close()
      NSGradient(starting: color.highlight(withLevel: 0.25)!, ending: color)!.draw(in: bubble, angle: -90)
      text(label, size: 300 * u, color: NSColor(srgbRed: 0.11, green: 0.12, blue: 0.15, alpha: 1), centerX: 512 * u, centerY: 559 * u)
    }
    NSGraphicsContext.restoreGraphicsState()
    let file = scale == 1 ? "icon_\(size)x\(size).png" : "icon_\(size)x\(size)@2x.png"
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[1] + "/" + file))
  }
}
`;

/** "Minecraft Bedrock Launcher" or a path → the app's path, from /Applications when it's only a name. */
export function findApp(nameOrPath) {
  const candidates = [nameOrPath, `${nameOrPath}.app`, ...['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')]
    .flatMap(d => [path.join(d, nameOrPath), path.join(d, `${nameOrPath}.app`)])];
  const found = candidates.find(c => c.endsWith('.app') && fs.existsSync(c));
  if (!found) throw new Error(`Can't find the app "${nameOrPath}": give its name from /Applications or its path`);
  return path.resolve(found);
}

function run(cmd, args, what) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout || '').trim() || `${cmd} exited ${r.status}`}`);
  return r.stdout;
}

/** Builds <dir>/<name>.app; returns its path. */
export function makeApp({ cwd, name, command, terminal = defaultTerminal(), icon, color, iconApp, dir = path.join(os.homedir(), 'Applications') }) {
  const app = path.join(dir, `${appName(name)}.app`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kidex-app-'));
  try {
    fs.mkdirSync(dir, { recursive: true });
    const script = path.join(tmp, 'open.applescript');
    fs.writeFileSync(script, appleScript({ cwd, command, terminal }));
    const built = path.join(tmp, 'built.app');
    run('osacompile', ['-o', built, script], 'Making the app');
    const iconset = path.join(tmp, 'icon.iconset');
    fs.mkdirSync(iconset);
    fs.writeFileSync(path.join(tmp, 'icon.swift'), ICON_SWIFT);
    run('swift', [path.join(tmp, 'icon.swift'), iconset, icon ?? [...name][0].toUpperCase(), color ?? (iconApp ? '#f4a641' : colorFor(name)), ...(iconApp ? [findApp(iconApp)] : [])], 'Drawing the icon (needs Xcode Command Line Tools: xcode-select --install)');
    // A new icon file name each build: the Dock caches icons and keeps showing the old one under the old name.
    const iconName = `icon-${Date.now().toString(36)}`;
    run('iconutil', ['-c', 'icns', iconset, '-o', path.join(built, `Contents/Resources/${iconName}.icns`)], 'Making the icon');
    fs.rmSync(path.join(built, 'Contents/Resources/applet.icns'), { force: true });
    fs.rmSync(path.join(built, 'Contents/Resources/Assets.car'), { force: true }); // newer osacompile icons win over CFBundleIconFile
    const plist = path.join(built, 'Contents/Info.plist');
    run('plutil', ['-replace', 'CFBundleIconFile', '-string', iconName, plist], 'Setting the icon');
    spawnSync('plutil', ['-remove', 'CFBundleIconName', plist]); // points at Assets.car, which is gone
    // A rebuild keeps the app's folder and swaps what's inside: the Dock and Desktop aliases keep pointing at it.
    fs.mkdirSync(app, { recursive: true });
    fs.rmSync(path.join(app, 'Contents'), { recursive: true, force: true });
    fs.renameSync(path.join(built, 'Contents'), path.join(app, 'Contents'));
    spawnSync('touch', [app]); // Finder and the Dock pick up the new icon
    spawnSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', app]);
    return app;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Adds the app to the end of the Dock, unless it's there already. */
export function addToDock(app) {
  const url = new URL(`file://${app}/`).href;
  const current = run('defaults', ['read', 'com.apple.dock', 'persistent-apps'], 'Reading the Dock');
  if (current.includes(url)) {
    // The Dock keeps showing a rebuilt app's old icon (or a "?") until its icon cache is gone and it restarts.
    const cache = spawnSync('getconf', ['DARWIN_USER_CACHE_DIR'], { encoding: 'utf8' }).stdout.trim();
    if (cache) fs.rmSync(path.join(cache, 'com.apple.dock.iconcache'), { force: true });
    spawnSync('killall', ['Dock']);
    return false;
  }
  const entry = `<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>${url}</string><key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>`;
  run('defaults', ['write', 'com.apple.dock', 'persistent-apps', '-array-add', entry], 'Adding to the Dock');
  spawnSync('killall', ['Dock']);
  return true;
}

/** A Finder alias on the Desktop, so it opens the real app and keeps its icon. */
export function addToDesktop(app) {
  const desktop = path.join(os.homedir(), 'Desktop');
  // Finder names the alias after the app, with or without ".app" and " alias".
  const base = path.basename(app);
  if ([base, path.basename(app, '.app'), `${base} alias`].some(n => fs.existsSync(path.join(desktop, n)))) return false;
  run('osascript', ['-e', `tell application "Finder" to make alias file to (POSIX file ${as(app)} as alias) at (path to desktop folder)`], 'Adding to the Desktop');
  return true;
}
