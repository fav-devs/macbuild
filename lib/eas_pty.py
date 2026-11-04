# Runs eas in a terminal so its prompts can be answered: eas_pty.py <eas args...>, replies as JSON lines on stdin.
import json
import os
import pty
import select
import sys

apple_id = os.environ.get("MACBUILD_APPLE_ID")
password_file = os.environ.get("MACBUILD_APPLE_PASSWORD_FILE")
if apple_id:
    os.environ["EXPO_APPLE_ID"] = apple_id
if password_file and os.path.exists(password_file):
    with open(password_file) as source:
        os.environ["EXPO_APPLE_PASSWORD"] = source.read().rstrip("\r\n")
os.environ["EAS_LOCAL_BUILD_SKIP_CLEANUP"] = "1"
child_pid, terminal = pty.fork()
if child_pid == 0:
    os.execvp("eas", ["eas"] + sys.argv[1:])
os.environ.pop("EXPO_APPLE_PASSWORD", None)
while True:
    ready, _, _ = select.select([terminal, sys.stdin], [], [])
    if terminal in ready:
        try:
            output = os.read(terminal, 65536)
        except OSError:
            break
        if not output:
            break
        sys.stdout.buffer.write(output)
        sys.stdout.buffer.flush()
    if sys.stdin in ready:
        os.write(terminal, json.loads(sys.stdin.readline())["text"].encode())
_, status = os.waitpid(child_pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
