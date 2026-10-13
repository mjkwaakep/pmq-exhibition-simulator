import http.server, socketserver, os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
PORT = 5300
with socketserver.TCPServer(("127.0.0.1", PORT), H) as httpd:
    httpd.serve_forever()
