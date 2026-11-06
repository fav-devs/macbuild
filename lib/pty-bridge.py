#!/usr/bin/env python3
# Runs a command in a pseudo-terminal and relays it over stdin and stdout, so a program that wants a terminal (Expo's
# dev server with its keys and prompts, or the setup TUI) can be driven from Node. Used by lib/devserver.mjs and the
# demo's web terminal.
#   python3 pty-bridge.py COLS ROWS COMMAND [ARGS...]
# File descriptor 3, when open, takes "COLS ROWS" lines to resize the terminal. The command leads its own session, so
# SIGTERM, SIGINT and SIGHUP here, and the end of stdin (whoever started this went away), go to its whole process
# group: Metro's file watchers and workers stop with it. A group that ignores SIGTERM gets SIGKILL 4 seconds later.
import fcntl, os, pty, select, signal, struct, sys, termios

cols, rows, argv = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]


def size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))


pid, fd = pty.fork()
if pid == 0:
    size(0, cols, rows)
    os.execvp(argv[0], argv)
stopping = False


def stop(*_):
    global stopping
    if not stopping:
        stopping = True
        signal.signal(signal.SIGALRM, lambda *_: kill(signal.SIGKILL))
        signal.alarm(4)
    kill(signal.SIGTERM)


def kill(signum):
    try:
        os.killpg(pid, signum)
    except (ProcessLookupError, PermissionError):
        pass


for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(signum, stop)
inputs = [fd, 0]
control = b''
try:
    os.fstat(3)
    inputs.append(3)
except OSError:
    pass
while True:
    try:
        ready, _, _ = select.select(inputs, [], [])
    except InterruptedError:
        continue
    if fd in ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(1, data)
    if 0 in ready:
        data = os.read(0, 65536)
        if not data:
            inputs.remove(0)
            stop()
            continue
        try:
            os.write(fd, data)
        except OSError:
            pass
    if 3 in ready:
        data = os.read(3, 4096)
        if not data:
            inputs.remove(3)
            continue
        control += data
        while b'\n' in control:
            line, control = control.split(b'\n', 1)
            try:
                new_cols, new_rows = (int(part) for part in line.split())
                if 20 <= new_cols <= 400 and 5 <= new_rows <= 200:
                    size(fd, new_cols, new_rows)
                    kill(signal.SIGWINCH)
            except ValueError:
                pass
while True:
    try:
        _, status = os.waitpid(pid, 0)
        break
    except InterruptedError:
        continue
    except ChildProcessError:
        status = 0
        break
sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status) if os.WIFSIGNALED(status) else 1)
