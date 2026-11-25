import http.server, sys, functools
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if COI:
            self.send_header('Cross-Origin-Opener-Policy','same-origin')
            self.send_header('Cross-Origin-Embedder-Policy','credentialless')
        super().end_headers()
    def log_message(self,*a): pass
COI = sys.argv[2]=='1'
http.server.ThreadingHTTPServer(('127.0.0.1',int(sys.argv[1])), functools.partial(H, directory='/home/claude/app/dist')).serve_forever()
