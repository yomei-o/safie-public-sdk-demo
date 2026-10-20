// Minimal static-file HTTP server for the Safie OAuth (Public client) sample.
//
// The server has no application logic: it only serves the files under ./www.
// Authorization (PKCE), token storage/refresh and every Safie API call happen
// in the browser through the Safie SDK (JavaScript), so no client secret and
// no TLS client code are needed here.
//
// Build (w64devkit / MinGW):  make
// Build (MSVC):               cmake -S . -B build && cmake --build build --config Release
// Run:                        server.exe [--host localhost] [--port 8080] [--root www]

#include "third_party/httplib.h"

#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>

// Configure one server instance: static mount + dev headers + request log.
static bool setup(httplib::Server& svr, const std::string& root) {
    if (!svr.set_mount_point("/", root)) return false;

    // Development convenience: never let the browser cache app files.
    svr.set_post_routing_handler([](const httplib::Request&, httplib::Response& res) {
        res.set_header("Cache-Control", "no-store");
    });

    svr.set_logger([](const httplib::Request& req, const httplib::Response& res) {
        std::printf("%s %s -> %d\n", req.method.c_str(), req.path.c_str(), res.status);
        std::fflush(stdout);
    });
    return true;
}

int main(int argc, char** argv) {
    std::string host = "localhost";
    int port = 8080;
    std::string root = "www";

    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        auto next = [&](const char* name) -> std::string {
            if (i + 1 >= argc) {
                std::fprintf(stderr, "%s needs a value\n", name);
                std::exit(2);
            }
            return argv[++i];
        };
        if (a == "--host") host = next("--host");
        else if (a == "--port") port = std::atoi(next("--port").c_str());
        else if (a == "--root") root = next("--root");
        else {
            std::fprintf(stderr, "usage: %s [--host H] [--port P] [--root DIR]\n", argv[0]);
            return 2;
        }
    }

    // "localhost" resolves to ::1 on Windows and cpp-httplib binds only the first
    // address, so 127.0.0.1 would be left unbound. Listen on both explicitly;
    // the browser may pick either one for http://localhost:PORT/.
    httplib::Server v4, v6;
    if (!setup(v4, root) || !setup(v6, root)) {
        std::fprintf(stderr, "cannot mount %s (does the directory exist?)\n", root.c_str());
        return 1;
    }

    std::printf("serving %s on http://%s:%d/\n", root.c_str(), host.c_str(), port);
    std::fflush(stdout);

    if (host != "localhost") {
        if (!v4.listen(host, port)) {
            std::fprintf(stderr, "listen on %s:%d failed\n", host.c_str(), port);
            return 1;
        }
        return 0;
    }

    std::thread t6([&] {
        if (!v6.listen("::1", port)) std::fprintf(stderr, "(IPv6 ::1:%d not available)\n", port);
    });
    bool ok = v4.listen("127.0.0.1", port);
    if (!ok) std::fprintf(stderr, "listen on 127.0.0.1:%d failed\n", port);
    v6.stop();
    t6.join();
    return ok ? 0 : 1;
}
