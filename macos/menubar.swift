import AppKit
import CoreGraphics
import Foundation
import UserNotifications

struct Snapshot {
    var reachable = false
    var url = "http://127.0.0.1:4180"
    var phoneUrl = ""
    var loginAtLogin = false
    var current: [String: Any]?
    var last: [String: Any]?
    var queued = 0
    var projects: [String] = []
    var doctorMiss = 0
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var item: NSStatusItem!
    let menu = NSMenu()
    var snapshot = Snapshot()
    var timer: Timer?
    var lastNotified = ""
    var seenCurrent = ""
    let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 2
        config.timeoutIntervalForResource = 3
        return URLSession(configuration: config)
    }()

    var port: String { ProcessInfo.processInfo.environment["MACBUILD_UI_PORT"] ?? "4180" }
    func api(_ path: String) -> URL { URL(string: "http://127.0.0.1:\(port)\(path)")! }
    // Naked binaries have no bundle id; currentNotificationCenter asserts and then SIGSEGVs.
    var canNotify: Bool { Bundle.main.bundleIdentifier != nil }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // A status item created before WindowServer stays invisible; KeepAlive restarts us in Aqua.
        guard CGSessionCopyCurrentDictionary() != nil else { exit(1) }
        NSApp.setActivationPolicy(.accessory)
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        guard item.button != nil else { exit(1) }
        let button = item.button
        button?.image = NSImage(systemSymbolName: "hammer.fill", accessibilityDescription: "macbuild")
        button?.image?.isTemplate = true
        button?.toolTip = "macbuild"
        menu.delegate = self
        item.menu = menu
        if canNotify {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.refresh() }
        RunLoop.main.add(timer!, forMode: .common)
    }

    func menuNeedsUpdate(_ menu: NSMenu) { draw() }

    func refresh() {
        session.dataTask(with: api("/api/menubar")) { [weak self] data, response, _ in
            guard let self else { return }
            var next = Snapshot()
            next.url = "http://127.0.0.1:\(self.port)"
            if let data, let http = response as? HTTPURLResponse, http.statusCode == 200,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                next.reachable = true
                next.url = json["url"] as? String ?? next.url
                next.phoneUrl = json["phoneUrl"] as? String ?? ""
                next.loginAtLogin = json["loginAtLogin"] as? Bool ?? false
                next.current = json["current"] as? [String: Any]
                next.last = json["last"] as? [String: Any]
                next.queued = json["queued"] as? Int ?? 0
                next.projects = json["projects"] as? [String] ?? []
                next.doctorMiss = json["doctorMiss"] as? Int ?? 0
            }
            DispatchQueue.main.async {
                self.snapshot = next
                self.notifyIfNeeded()
                self.markBusy(next.current != nil)
            }
        }.resume()
    }

    func markBusy(_ busy: Bool) {
        item.button?.appearsDisabled = false
        item.button?.toolTip = busy ? "macbuild · building" : "macbuild"
        if let image = NSImage(systemSymbolName: busy ? "hammer.fill" : "hammer.fill", accessibilityDescription: "macbuild") {
            image.isTemplate = true
            item.button?.image = image
        }
        item.button?.title = busy ? " ·" : ""
    }

    func notifyIfNeeded() {
        if let current = snapshot.current, let id = current["id"] as? String { seenCurrent = id; return }
        guard canNotify, snapshot.reachable, let last = snapshot.last else { return }
        let id = last["id"] as? String ?? ""
        let status = last["status"] as? String ?? ""
        guard !seenCurrent.isEmpty, seenCurrent == id, id != lastNotified, ["success", "failed", "cancelled"].contains(status) else { return }
        lastNotified = id
        seenCurrent = ""
        let project = last["project"] as? String ?? "build"
        let content = UNMutableNotificationContent()
        content.title = "\(project): \(status == "success" ? "build finished" : status == "failed" ? "build failed" : "build cancelled")"
        content.body = last["subject"] as? String ?? ""
        let req = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }

    func draw() {
        menu.removeAllItems()
        if !snapshot.reachable {
            add("Can’t reach the dashboard", enabled: false)
            add("Open Dashboard", action: #selector(openDashboard))
            add("Setup Guide", action: #selector(openSetup))
            menu.addItem(.separator())
            add("Quit Menu Bar", action: #selector(quit), key: "q")
            return
        }
        if let current = snapshot.current {
            let project = current["project"] as? String ?? "app"
            let profile = current["profile"] as? String ?? ""
            add("Building \(project)\(profile.isEmpty ? "" : " · \(profile)")", enabled: false)
            add("Open build", action: #selector(openCurrent))
        } else if let last = snapshot.last {
            let project = last["project"] as? String ?? "build"
            let status = last["status"] as? String ?? ""
            let label = status == "success" ? "Last: \(project) finished" : status == "failed" ? "Last: \(project) failed" : "Idle"
            add(label, enabled: false)
            if snapshot.queued > 0 { add("\(snapshot.queued) waiting", enabled: false) }
        } else {
            add(snapshot.queued > 0 ? "Idle, \(snapshot.queued) waiting" : "Idle", enabled: false)
        }
        add("Open Dashboard", action: #selector(openDashboard))
        add("Setup Guide", action: #selector(openSetup))
        if !snapshot.phoneUrl.isEmpty {
            add("Copy Phone URL", action: #selector(copyPhone))
        }
        if snapshot.doctorMiss > 0 {
            add("\(snapshot.doctorMiss) setup \(snapshot.doctorMiss == 1 ? "item" : "items") missing", action: #selector(openSetup))
        }
        if !snapshot.projects.isEmpty {
            menu.addItem(.separator())
            for name in snapshot.projects.prefix(6) {
                let item = NSMenuItem(title: "Build \(name)", action: #selector(buildProject(_:)), keyEquivalent: "")
                item.representedObject = name
                item.target = self
                item.isEnabled = snapshot.current == nil
                menu.addItem(item)
            }
        }
        menu.addItem(.separator())
        let login = NSMenuItem(title: "Open at Login", action: #selector(toggleLogin), keyEquivalent: "")
        login.state = snapshot.loginAtLogin ? .on : .off
        login.target = self
        menu.addItem(login)
        add("Quit Menu Bar", action: #selector(quit), key: "q")
    }

    func add(_ title: String, action: Selector? = nil, key: String = "", enabled: Bool = true) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = action == nil ? nil : self
        item.isEnabled = enabled
        menu.addItem(item)
    }

    @objc func openDashboard() { NSWorkspace.shared.open(URL(string: snapshot.url)!) }
    @objc func openSetup() { NSWorkspace.shared.open(URL(string: "\(snapshot.url)/#/setup")!) }
    @objc func openCurrent() {
        if let id = snapshot.current?["id"] as? String {
            NSWorkspace.shared.open(URL(string: "\(snapshot.url)/#/build/\(id)")!)
        } else { openDashboard() }
    }
    @objc func copyPhone() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(snapshot.phoneUrl, forType: .string)
    }
    @objc func toggleLogin() {
        post("/api/setup", ["loginAtLogin": !snapshot.loginAtLogin]) { [weak self] in self?.refresh() }
    }
    @objc func buildProject(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        post("/api/builds", ["project": name, "profile": "development"]) { [weak self] in
            self?.refresh()
            DispatchQueue.main.async { self?.openDashboard() }
        }
    }
    @objc func quit() { NSApp.terminate(nil) }

    func post(_ path: String, _ body: [String: Any], done: (() -> Void)? = nil) {
        var req = URLRequest(url: api(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("1", forHTTPHeaderField: "x-macbuild")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        session.dataTask(with: req) { _, _, _ in DispatchQueue.main.async { done?() } }.resume()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
