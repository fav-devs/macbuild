#!/usr/bin/env python3
# Drives a terminal program the way a person would, for the setup TUI's tests and screenshots.
#   python3 test/drive-tty.py SCRIPT.json [TRANSCRIPT]   SCRIPT: {"argv": [...], "cwd": "...", "env": {...}, "steps": [[pattern, keys], ...]}
# Each step waits until the screen text (escape codes removed) matches pattern after the previous match, then types keys.
# Prints the plain screen text at the end; TRANSCRIPT gets the raw bytes, escape codes and all. Exits 1 on a timeout.
import json, os, pty, re, select, signal, struct, sys, time, fcntl, termios

script = json.load(open(sys.argv[1]))
transcript = sys.argv[2] if len(sys.argv) > 2 else None
ansi = re.compile(rb'\x1b\[[0-9;?]*[A-Za-z]')
env = dict(os.environ, **script.get('env', {}))
env['TERM'] = 'xterm-256color'
pid, fd = pty.fork()
if pid == 0:
    os.chdir(script.get('cwd', '.'))
    os.execvpe(script['argv'][0], script['argv'], env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', script.get('rows', 40), script.get('cols', 92), 0, 0))
raw = b''
plain = ''
at = 0

def pump(timeout):
    global raw, plain
    ready, _, _ = select.select([fd], [], [], timeout)
    if not ready:
        return True
    try:
        chunk = os.read(fd, 65536)
    except OSError:
        return False
    if not chunk:
        return False
    raw += chunk
    plain = ansi.sub(b'', raw).decode('utf8', 'replace')
    return True

def finish(code):
    if transcript:
        open(transcript, 'wb').write(raw)
    sys.stdout.write(plain)
    sys.exit(code)

for pattern, keys in script['steps']:
    deadline = time.time() + script.get('timeout', 20)
    found = None
    while time.time() < deadline:
        found = re.compile(pattern, re.S).search(plain, at)
        if found:
            break
        if not pump(0.1):
            break
    if not found:
        sys.stderr.write('timed out waiting for %r\n' % pattern)
        try: os.kill(pid, signal.SIGTERM)
        except OSError: pass
        finish(1)
    at = found.end()
    time.sleep(script.get('pause', 0.15))
    for key in keys if isinstance(keys, list) else [keys]:
        if not key:
            continue
        try:
            os.write(fd, key.encode())
        except OSError:
            break  # the program has exited (macOS says EIO)
        time.sleep(script.get('keyPause', 0.05))
        pump(0.02)

# Let it finish, then report how it exited.
deadline = time.time() + script.get('timeout', 20)
while time.time() < deadline and pump(0.1):
    pass
try:
    _, status = os.waitpid(pid, 0)
    code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1
except ChildProcessError:
    code = 0
if transcript:
    open(transcript, 'wb').write(raw)
sys.stdout.write(plain)
sys.stderr.write('exit %d\n' % code)
sys.exit(0 if code == script.get('expect', 0) else 1)
