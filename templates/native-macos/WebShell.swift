import Cocoa
import WebKit
import Network
import Darwin

// MARK: - Config Models

struct LocalConfig: Codable {
    var kind: String?           // "static" | "command"
    var entryDir: String?       // relative to Contents/Resources/ or absolute
    var workDir: String?        // working directory for command mode
    var startCommand: String?   // e.g. "node server.js"
    var healthPath: String?     // e.g. "/"
    var startupTimeoutSec: Int? // default 25
}

struct AppConfig: Codable {
    var name: String
    var bundleId: String?
    var mode: String?           // "url" | "local"
    var url: String?
    var width: Double?
    var height: Double?
    var minWidth: Double?
    var minHeight: Double?
    var hideTitlebar: Bool?
    var alwaysOnTop: Bool?
    var tray: Bool?
    var userAgent: String?
    var customCSS: String?
    var customJS: String?
    var openExternalLinks: Bool?
    var local: LocalConfig?
}

// MARK: - Free Port Finder

func findFreePort() -> UInt16 {
    let sock = socket(AF_INET, SOCK_STREAM, 0)
    guard sock >= 0 else { return 18900 }
    defer { close(sock) }
    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = 0
    addr.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    let bindResult = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            bind(sock, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    guard bindResult == 0 else { return 18900 }
    var len = socklen_t(MemoryLayout<sockaddr_in>.size)
    var outAddr = sockaddr_in()
    let nameResult = withUnsafeMutablePointer(to: &outAddr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            getsockname(sock, $0, &len)
        }
    }
    guard nameResult == 0 else { return 18900 }
    return UInt16(bigEndian: outAddr.sin_port)
}

// MARK: - Built-in Zero-Dependency Static HTTP Server (Network.framework)

final class EmbeddedStaticServer {
    private let rootURL: URL
    private let port: UInt16
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "cn.huixin.web2desktop.staticserver", qos: .userInitiated)

    init(rootURL: URL, port: UInt16) {
        self.rootURL = rootURL.standardizedFileURL
        self.port = port
    }

    func start() throws {
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            throw NSError(domain: "StaticServer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid port"])
        }
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: nwPort)
        let listener = try NWListener(using: params)
        listener.newConnectionHandler = { [weak self] conn in
            self?.handle(conn)
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func handle(_ conn: NWConnection) {
        conn.start(queue: queue)
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, _ in
            defer { conn.cancel() }
            guard let self = self, let data = data, let req = String(data: data, encoding: .utf8) else {
                return
            }
            let firstLine = req.split(separator: "\r\n", maxSplits: 1).first ?? ""
            let parts = firstLine.split(separator: " ")
            var rawPath = parts.count >= 2 ? String(parts[1]) : "/"
            if let qIdx = rawPath.firstIndex(of: "?") {
                rawPath = String(rawPath[..<qIdx])
            }
            let decodedPath = rawPath.removingPercentEncoding ?? rawPath
            let cleanRel = decodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))

            var candidate = cleanRel.isEmpty
                ? self.rootURL.appendingPathComponent("index.html")
                : self.rootURL.appendingPathComponent(cleanRel)
            candidate = candidate.standardizedFileURL

            // Prevent directory traversal
            guard candidate.path.hasPrefix(self.rootURL.path) else {
                self.send(conn, status: "403 Forbidden", mime: "text/plain", body: Data("Forbidden".utf8))
                return
            }

            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDir) {
                if isDir.boolValue {
                    candidate = candidate.appendingPathComponent("index.html")
                }
            } else {
                // SPA fallback
                let spaIndex = self.rootURL.appendingPathComponent("index.html")
                if FileManager.default.fileExists(atPath: spaIndex.path) {
                    candidate = spaIndex
                }
            }

            if let fileData = try? Data(contentsOf: candidate) {
                let mime = Self.mimeType(for: candidate.pathExtension.lowercased())
                self.send(conn, status: "200 OK", mime: mime, body: fileData)
            } else {
                self.send(conn, status: "404 Not Found", mime: "text/plain; charset=utf-8", body: Data("Not Found".utf8))
            }
        }
    }

    private func send(_ conn: NWConnection, status: String, mime: String, body: Data) {
        var header = "HTTP/1.1 \(status)\r\n"
        header += "Content-Type: \(mime)\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Cache-Control: no-cache\r\n"
        header += "Connection: close\r\n\r\n"
        var payload = Data(header.utf8)
        payload.append(body)
        conn.send(content: payload, completion: .contentProcessed { _ in
            conn.cancel()
        })
    }

    private static func mimeType(for ext: String) -> String {
        switch ext {
        case "html", "htm": return "text/html; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "mp4": return "video/mp4"
        case "mp3": return "audio/mpeg"
        case "wasm": return "application/wasm"
        default: return "application/octet-stream"
        }
    }
}

// MARK: - AppDelegate

final class WebShellAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var config: AppConfig!
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem?
    private var staticServer: EmbeddedStaticServer?
    private var childProcess: Process?
    private var activeURL: URL?
    private var downloadDestMap: [ObjectIdentifier: URL] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        self.config = loadConfig()
        setupMainMenu()
        setupWindowAndWebView()
        if config.tray == true {
            setupTray()
        }
        startContent()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            window.makeKeyAndOrderFront(nil)
        }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return config.tray != true
    }

    func applicationWillTerminate(_ notification: Notification) {
        staticServer?.stop()
        terminateChildProcess()
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if config.tray == true {
            window.orderOut(nil)
            return false
        }
        return true
    }

    // MARK: - Config

    private func loadConfig() -> AppConfig {
        if let resURL = Bundle.main.resourceURL?.appendingPathComponent("app-config.json"),
           let data = try? Data(contentsOf: resURL),
           let cfg = try? JSONDecoder().decode(AppConfig.self, from: data) {
            return cfg
        }
        return AppConfig(
            name: Bundle.main.infoDictionary?["CFBundleDisplayName"] as? String ?? "Huixin Web App",
            bundleId: Bundle.main.bundleIdentifier,
            mode: "url",
            url: "https://github.com/sixwei2025",
            width: 1200,
            height: 800,
            minWidth: 640,
            minHeight: 480,
            hideTitlebar: false,
            alwaysOnTop: false,
            tray: false,
            userAgent: nil,
            customCSS: nil,
            customJS: nil,
            openExternalLinks: true,
            local: nil
        )
    }

    // MARK: - Window & WebView

    private func setupWindowAndWebView() {
        let w = CGFloat(config.width ?? 1280)
        let h = CGFloat(config.height ?? 840)
        var style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable]
        if config.hideTitlebar == true {
            style.insert(.fullSizeContentView)
        }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: w, height: h),
            styleMask: style,
            backing: .buffered,
            defer: false
        )
        window.title = config.name
        window.minSize = NSSize(width: CGFloat(config.minWidth ?? 600), height: CGFloat(config.minHeight ?? 420))
        window.center()
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("MainWindow.\(config.bundleId ?? config.name)")

        if config.hideTitlebar == true {
            window.titleVisibility = .hidden
            window.titlebarAppearsTransparent = true
        }
        if config.alwaysOnTop == true {
            window.level = .floating
        }

        let wkConfig = WKWebViewConfiguration()
        wkConfig.websiteDataStore = .default()
        wkConfig.preferences.javaScriptCanOpenWindowsAutomatically = true
        wkConfig.preferences.setValue(true, forKey: "developerExtrasEnabled")

        let userContent = WKUserContentController()
        if let css = config.customCSS, !css.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let escapedCSS = css
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "`", with: "\\`")
            let cssScript = """
            (function() {
              const style = document.createElement('style');
              style.id = 'huixin-web2desktop-custom-css';
              style.textContent = `\(escapedCSS)`;
              (document.head || document.documentElement).appendChild(style);
            })();
            """
            userContent.addUserScript(WKUserScript(source: cssScript, injectionTime: .atDocumentEnd, forMainFrameOnly: false))
        }
        if let js = config.customJS, !js.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            userContent.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        wkConfig.userContentController = userContent

        webView = WKWebView(frame: window.contentView!.bounds, configuration: wkConfig)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true

        if let ua = config.userAgent, !ua.isEmpty {
            webView.customUserAgent = ua
        } else {
            webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
        }

        window.contentView?.addSubview(webView)
        window.makeKeyAndOrderFront(nil)
    }

    // MARK: - Content Startup (URL or Local Project)

    private func startContent() {
        if config.mode == "local", let local = config.local {
            startLocalProject(local)
            return
        }
        guard let urlStr = config.url, let url = URL(string: urlStr) else {
            showStatusHTML(title: "未配置有效网址", detail: "请检查 app-config.json 中的 url 配置。")
            return
        }
        activeURL = url
        webView.load(URLRequest(url: url))
    }

    private func startLocalProject(_ local: LocalConfig) {
        let port = findFreePort()
        let kind = local.kind ?? "static"

        if kind == "static" {
            let entry = local.entryDir ?? "site"
            let rootURL: URL
            if entry.hasPrefix("/") {
                rootURL = URL(fileURLWithPath: entry)
            } else {
                rootURL = (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent(entry)
            }
            let server = EmbeddedStaticServer(rootURL: rootURL, port: port)
            do {
                try server.start()
                self.staticServer = server
                let target = URL(string: "http://127.0.0.1:\(port)/")!
                self.activeURL = target
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                    self.webView.load(URLRequest(url: target))
                }
            } catch {
                showStatusHTML(title: "本地静态服务启动失败", detail: error.localizedDescription)
            }
            return
        }

        // Command mode: launch backend service & poll health endpoint
        guard let startCmd = local.startCommand, !startCmd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            showStatusHTML(title: "缺少启动命令", detail: "本地项目模式需要配置 startCommand。")
            return
        }

        showStatusHTML(title: "正在启动 \(config.name)...", detail: "本地服务初始化中，请稍候片刻")

        let dataDir = persistentDataDir()
        try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)

        let workURL: URL
        if let wd = local.workDir, !wd.isEmpty {
            workURL = wd.hasPrefix("/")
                ? URL(fileURLWithPath: wd)
                : (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent(wd)
        } else {
            workURL = (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent(local.entryDir ?? "app")
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-lc", startCmd]
        proc.currentDirectoryURL = workURL

        var env = ProcessInfo.processInfo.environment
        let extraPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        env["PATH"] = extraPath + ":" + (env["PATH"] ?? "")
        env["PORT"] = String(port)
        env["HUIXIN_PORT"] = String(port)
        env["HUIXIN_DATA_DIR"] = dataDir.path
        env["DATA_DIR"] = dataDir.path
        proc.environment = env

        let logURL = dataDir.appendingPathComponent("service.log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        if let logHandle = try? FileHandle(forWritingTo: logURL) {
            proc.standardOutput = logHandle
            proc.standardError = logHandle
        }

        do {
            try proc.run()
            self.childProcess = proc
            // Put child in its own process group if possible for clean shutdown
            setpgid(proc.processIdentifier, proc.processIdentifier)
        } catch {
            showStatusHTML(title: "启动本地服务失败", detail: error.localizedDescription)
            return
        }

        let healthPath = local.healthPath ?? "/"
        let cleanHealth = healthPath.hasPrefix("/") ? healthPath : "/" + healthPath
        let targetURL = URL(string: "http://127.0.0.1:\(port)\(cleanHealth)")!
        self.activeURL = targetURL

        let timeoutSec = Double(local.startupTimeoutSec ?? 25)
        let deadline = Date().addingTimeInterval(timeoutSec)
        pollHealth(url: targetURL, deadline: deadline)
    }

    private func pollHealth(url: URL, deadline: Date) {
        var req = URLRequest(url: url)
        req.timeoutInterval = 1.5
        URLSession.shared.dataTask(with: req) { [weak self] _, response, _ in
            guard let self = self else { return }
            if let http = response as? HTTPURLResponse, http.statusCode >= 200 && http.statusCode < 500 {
                DispatchQueue.main.async {
                    self.webView.load(URLRequest(url: url))
                }
                return
            }
            if let proc = self.childProcess, !proc.isRunning {
                DispatchQueue.main.async {
                    let logPath = self.persistentDataDir().appendingPathComponent("service.log").path
                    let logTail = (try? String(contentsOfFile: logPath, encoding: .utf8))?.suffix(600) ?? ""
                    self.showStatusHTML(
                        title: "本地服务意外退出（Exit \(proc.terminationStatus)）",
                        detail: "请检查运行环境或日志：\(logPath)\n\n\(logTail)"
                    )
                }
                return
            }
            if Date() < deadline {
                DispatchQueue.global().asyncAfter(deadline: .now() + 0.25) {
                    self.pollHealth(url: url, deadline: deadline)
                }
            } else {
                DispatchQueue.main.async {
                    self.showStatusHTML(title: "本地服务启动超时", detail: "在规定时间内未响应 \(url.absoluteString)。")
                }
            }
        }.resume()
    }

    private func persistentDataDir() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let folder = config.bundleId ?? "cn.huixin.web2desktop.app"
        return base.appendingPathComponent(folder, isDirectory: true)
    }

    private func terminateChildProcess() {
        guard let proc = childProcess, proc.isRunning else { return }
        let pid = proc.processIdentifier
        kill(-pid, SIGTERM)
        proc.terminate()
    }

    private func showStatusHTML(title: String, detail: String) {
        let safeTitle = title.replacingOccurrences(of: "<", with: "&lt;")
        let safeDetail = detail.replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: "\n", with: "<br/>")
        let html = """
        <!doctype html>
        <html><head><meta charset="utf-8"><style>
        body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
               font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;
               background:#0f1115; color:#f4f4f5; }
        .card { max-width:520px; padding:32px 36px; border-radius:16px; background:#181b22;
                border:1px solid rgba(255,255,255,0.08); text-align:center; }
        .dot { width:12px; height:12px; border-radius:50%; background:#C8102E; margin:0 auto 16px;
               animation:pulse 1.2s infinite ease-in-out; }
        h2 { margin:0 0 10px; font-size:20px; font-weight:600; }
        p { margin:0; font-size:13px; line-height:1.6; color:#a1a1aa; word-break:break-all; }
        @keyframes pulse { 0%,100%{transform:scale(0.9);opacity:0.6;} 50%{transform:scale(1.2);opacity:1;} }
        </style></head><body>
        <div class="card"><div class="dot"></div><h2>\(safeTitle)</h2><p>\(safeDetail)</p></div>
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: - Tray

    private func setupTray() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let btn = item.button {
            btn.title = String(config.name.prefix(4))
            btn.action = #selector(toggleWindow)
            btn.target = self
        }
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "显示 / 隐藏 \(config.name)", action: #selector(toggleWindow), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "重新加载", action: #selector(reloadPage), keyEquivalent: "r"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "退出 \(config.name)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        item.menu = menu
        self.statusItem = item
    }

    @objc private func toggleWindow() {
        if window.isVisible && NSApp.isActive {
            window.orderOut(nil)
        } else {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    // MARK: - Menu Bar

    private func setupMainMenu() {
        let mainMenu = NSMenu()

        // App Menu
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "关于 \(config.name)", action: #selector(showAbout), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "隐藏 \(config.name)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "退出 \(config.name)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appItem.submenu = appMenu

        // Edit Menu (essential for Cmd+C/V/X/A/Z in WKWebView!)
        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(NSMenuItem(title: "撤销", action: Selector(("undo:")), keyEquivalent: "z"))
        editMenu.addItem(NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "Z"))
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(NSMenuItem(title: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editItem.submenu = editMenu

        // View Menu
        let viewItem = NSMenuItem()
        mainMenu.addItem(viewItem)
        let viewMenu = NSMenu(title: "视图")
        viewMenu.addItem(NSMenuItem(title: "刷新页面", action: #selector(reloadPage), keyEquivalent: "r"))
        let hardReload = NSMenuItem(title: "强制刷新", action: #selector(hardReloadPage), keyEquivalent: "R")
        hardReload.keyEquivalentModifierMask = [.command, .shift]
        viewMenu.addItem(hardReload)
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(NSMenuItem(title: "后退", action: #selector(goBack), keyEquivalent: "["))
        viewMenu.addItem(NSMenuItem(title: "前进", action: #selector(goForward), keyEquivalent: "]"))
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(NSMenuItem(title: "放大", action: #selector(zoomIn), keyEquivalent: "="))
        viewMenu.addItem(NSMenuItem(title: "缩小", action: #selector(zoomOut), keyEquivalent: "-"))
        viewMenu.addItem(NSMenuItem(title: "实际大小", action: #selector(zoomReset), keyEquivalent: "0"))
        viewMenu.addItem(NSMenuItem.separator())
        let copyURLItem = NSMenuItem(title: "复制当前网址", action: #selector(copyCurrentURL), keyEquivalent: "C")
        copyURLItem.keyEquivalentModifierMask = [.command, .shift]
        viewMenu.addItem(copyURLItem)
        let openBrowserItem = NSMenuItem(title: "在默认浏览器打开", action: #selector(openInDefaultBrowser), keyEquivalent: "O")
        openBrowserItem.keyEquivalentModifierMask = [.command, .shift]
        viewMenu.addItem(openBrowserItem)
        viewItem.submenu = viewMenu

        // Window Menu
        let winItem = NSMenuItem()
        mainMenu.addItem(winItem)
        let winMenu = NSMenu(title: "窗口")
        winMenu.addItem(NSMenuItem(title: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
        winMenu.addItem(NSMenuItem(title: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
        winMenu.addItem(NSMenuItem(title: "切换窗口置顶", action: #selector(toggleAlwaysOnTop), keyEquivalent: "t"))
        winItem.submenu = winMenu

        NSApp.mainMenu = mainMenu
    }

    @objc private func showAbout() {
        let alert = NSAlert()
        alert.messageText = config.name
        alert.informativeText = "由「汇芯网页转桌面 (huixin-web-to-desktop)」原生引擎打包生成。\n出品：袁六伟 · 台州汇芯（MIT 开源）"
        alert.runModal()
    }

    @objc private func reloadPage() { webView.reload() }
    @objc private func hardReloadPage() { webView.reloadFromOrigin() }
    @objc private func goBack() { if webView.canGoBack { webView.goBack() } }
    @objc private func goForward() { if webView.canGoForward { webView.goForward() } }
    @objc private func zoomIn() { webView.pageZoom = min(webView.pageZoom + 0.1, 2.5) }
    @objc private func zoomOut() { webView.pageZoom = max(webView.pageZoom - 0.1, 0.5) }
    @objc private func zoomReset() { webView.pageZoom = 1.0 }

    @objc private func copyCurrentURL() {
        if let str = webView.url?.absoluteString {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(str, forType: .string)
        }
    }

    @objc private func openInDefaultBrowser() {
        if let u = webView.url ?? activeURL {
            NSWorkspace.shared.open(u)
        }
    }

    @objc private func toggleAlwaysOnTop() {
        window.level = (window.level == .floating) ? .normal : .floating
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            if config.openExternalLinks == true,
               let baseHost = activeURL?.host,
               let targetHost = url.host,
               targetHost != baseHost && !targetHost.hasSuffix("." + baseHost) {
                NSWorkspace.shared.open(url)
            } else {
                webView.load(navigationAction.request)
            }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let nsErr = error as NSError
        if nsErr.code == NSURLErrorCancelled { return }
        showStatusHTML(title: "页面加载失败", detail: "\(error.localizedDescription)\n\n按 Cmd+R 重试")
    }

    // MARK: - WKDownloadDelegate

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let downloadsDir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
        var dest = downloadsDir.appendingPathComponent(suggestedFilename)
        var counter = 1
        while FileManager.default.fileExists(atPath: dest.path) {
            let ext = dest.pathExtension
            let stem = dest.deletingPathExtension().lastPathComponent
            let newName = ext.isEmpty ? "\(stem)-\(counter)" : "\(stem)-\(counter).\(ext)"
            dest = downloadsDir.appendingPathComponent(newName)
            counter += 1
        }
        downloadDestMap[ObjectIdentifier(download)] = dest
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let dest = downloadDestMap.removeValue(forKey: ObjectIdentifier(download)) {
            NSWorkspace.shared.activateFileViewerSelecting([dest])
        }
    }

    // MARK: - WKUIDelegate (Upload Panel + JS Dialogs + Popup)

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if config.openExternalLinks == true,
               let baseHost = activeURL?.host,
               let targetHost = url.host,
               targetHost != baseHost && !targetHost.hasSuffix("." + baseHost) {
                NSWorkspace.shared.open(url)
            } else {
                webView.load(navigationAction.request)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = config.name
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = config.name
        alert.informativeText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { resp in
            completionHandler(resp == .alertFirstButtonReturn)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = config.name
        alert.informativeText = prompt
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        input.stringValue = defaultText ?? ""
        alert.accessoryView = input
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { resp in
            completionHandler(resp == .alertFirstButtonReturn ? input.stringValue : nil)
        }
    }
}

// MARK: - Entry Point

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = WebShellAppDelegate()
app.delegate = delegate
app.run()
