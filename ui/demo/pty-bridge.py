#!/usr/bin/env python3
# Runs a command in a pseudo-terminal of a given size and relays it over stdin/stdout, for the demo's web terminal.
#   python3 pty-bridge.py COLS ROWS COMMAND [ARGS...]
import fcntl, os, pty, select, struct, sys, termios

cols, rows, argv = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
pid, fd = pty.fork()
if pid == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    os.execvp(argv[0], argv)
inputs = [fd, 0]
while True:
    ready, _, _ = select.select(inputs, [], [])
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
            inputs.remove(0)  # the page went away; let the program finish or be stopped
            continue
        os.write(fd, data)
_, status = os.waitpid(pid, 0)
sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)
