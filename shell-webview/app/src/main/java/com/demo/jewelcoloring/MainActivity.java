package com.demo.jewelcoloring;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;

public class MainActivity extends Activity {
    private static final int PORT = 8080;
    private WebView web;
    private ServerSocket server;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternal(request.getUrl().toString());
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openExternal(url);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                WebView newView = new WebView(view.getContext());
                view.addView(newView);
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(newView);
                resultMsg.sendToTarget();
                return true;
            }
        });

        startAssetServer();
        web.loadUrl("http://127.0.0.1:" + PORT + "/index.html");
        setContentView(web);
    }

    private void startAssetServer() {
        try {
            server = new ServerSocket(PORT, 50, InetAddress.getByName("127.0.0.1"));
            Thread t = new Thread(this::serveLoop, "asset-server");
            t.setDaemon(true);
            t.start();
        } catch (Exception ignored) {
        }
    }

    private void serveLoop() {
        while (true) {
            try {
                final Socket s = server.accept();
                new Thread(() -> handle(s)).start();
            } catch (Exception e) {
                break;
            }
        }
    }

    private void handle(Socket s) {
        try (Socket socket = s) {
            BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), "ISO-8859-1"));
            String req = in.readLine();
            if (req == null) return;
            String[] parts = req.split(" ");
            String path = parts.length > 1 ? parts[1] : "/";
            if (path.contains("?")) path = path.substring(0, path.indexOf('?'));
            if (path.equals("/")) path = "/index.html";
            OutputStream out = socket.getOutputStream();
            try (InputStream is = getAssets().open("www" + path)) {
                byte[] data = readAll(is);
                String head = "HTTP/1.0 200 OK\r\nContent-Type: " + typeFor(path) + "\r\nContent-Length: " + data.length + "\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
                out.write(head.getBytes("ISO-8859-1"));
                out.write(data);
            } catch (IOException e) {
                String head = "HTTP/1.0 404 Not Found\r\nContent-Length: 3\r\nConnection: close\r\n\r\n404";
                out.write(head.getBytes("ISO-8859-1"));
            }
            out.flush();
        } catch (Exception ignored) {
        }
    }

    private static byte[] readAll(InputStream is) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    private static String typeFor(String p) {
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".ogg")) return "audio/ogg";
        if (p.endsWith(".m4a")) return "audio/mp4";
        if (p.endsWith(".css")) return "text/css";
        return "application/octet-stream";
    }

    private boolean openExternal(String url) {
        if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception ignored) {
            }
            return true;
        }
        return false;
    }

    @Override
    public void onBackPressed() {
        moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        if (server != null) { try { server.close(); } catch (Exception ignored) { } }
        super.onDestroy();
    }
}