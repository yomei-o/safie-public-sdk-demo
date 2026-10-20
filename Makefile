# w64devkit / MinGW build. ws2_32 is the only system library cpp-httplib needs
# without TLS.
CXX      ?= g++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra
LDLIBS   := -lws2_32

server.exe: server.cpp third_party/httplib.h
	$(CXX) $(CXXFLAGS) server.cpp -o $@ $(LDLIBS)

run: server.exe
	./server.exe

clean:
	rm -f server.exe

.PHONY: run clean
