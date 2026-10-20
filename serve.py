#!/usr/bin/env python3
"""Static-file HTTP server for the Safie OAuth (Public client) sample.

Python counterpart of server.cpp: serves ./www with Cache-Control: no-store.
Like the C++ version it listens on both 127.0.0.1 and ::1 when --host is
"localhost", so http://localhost:8080/ works whichever address the browser picks.

Usage: python serve.py [--host localhost] [--port 8080] [--root www]
"""

import argparse
import os
import socket
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".html": "text/html; charset=utf-8",
    }

    def end_headers(self):
        # Development convenience: never let the browser cache app files.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write("%s %s\n" % (self.address_string(), fmt % args))
        sys.stdout.flush()


class V6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def serve(server_cls, host, port, root):
    httpd = server_cls((host, port), partial(Handler, directory=root))
    httpd.serve_forever()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--root", default="www")
    a = ap.parse_args()

    if not os.path.isdir(a.root):
        sys.exit("cannot mount %s (does the directory exist?)" % a.root)

    print("serving %s on http://%s:%d/" % (a.root, a.host, a.port), flush=True)

    if a.host != "localhost":
        cls = V6Server if ":" in a.host else ThreadingHTTPServer
        serve(cls, a.host, a.port, a.root)
        return

    # IPv6 loopback is optional (may be disabled); IPv4 loopback is required.
    def v6():
        try:
            serve(V6Server, "::1", a.port, a.root)
        except OSError as e:
            print("(IPv6 ::1:%d not available: %s)" % (a.port, e), file=sys.stderr)

    threading.Thread(target=v6, daemon=True).start()
    try:
        serve(ThreadingHTTPServer, "127.0.0.1", a.port, a.root)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
