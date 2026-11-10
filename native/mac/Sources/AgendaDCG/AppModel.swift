import SwiftUI
import PDFKit
import UserNotifications

struct APIError: LocalizedError { var message: String; var status: Int; var errorDescription: String? { message } }

enum API {
    static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.httpShouldSetCookies = false
        c.httpCookieStorage = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.timeoutIntervalForRequest = 30
        c.httpAdditionalHeaders = ["User-Agent": "AgendaDCG-Mac/\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev")"]
        return URLSession(configuration: c)
    }()

    /// Cookies de session gardés par l'app (fonctionne aussi en local sur http).
    static var cookies: [String: String] {
        get { UserDefaults.standard.dictionary(forKey: "cookies:\(SITE.host() ?? "")") as? [String: String] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: "cookies:\(SITE.host() ?? "")") }
    }

    static func request(_ path: String) -> URLRequest {
        var req = URLRequest(url: URL(string: "api/" + path, relativeTo: SITE)!)
        let c = cookies.map { "\($0.key)=\($0.value)" }.joined(separator: "; ")
        if !c.isEmpty { req.setValue(c, forHTTPHeaderField: "cookie") }
        return req
    }

    static func store(_ res: URLResponse) {
        guard let h = res as? HTTPURLResponse, h.url?.host() == SITE.host() else { return }
        var jar = cookies
        for (k, v) in h.allHeaderFields where (k as? String)?.lowercased() == "set-cookie" {
            for line in (v as? String ?? "").components(separatedBy: ", ") where line.contains("=") {
                let kv = line.split(separator: ";", maxSplits: 1)[0].split(separator: "=", maxSplits: 1).map(String.init)
                guard kv.count >= 1, ["agenda_session", "agenda_profile"].contains(kv[0]) else { continue }
                let value = kv.count > 1 ? kv[1] : ""
                if value.isEmpty || line.contains("Max-Age=0") { jar[kv[0]] = nil } else { jar[kv[0]] = value }
            }
        }
        cookies = jar
    }

    static func raw(_ path: String, method: String = "GET", body: Any? = nil) async throws -> (Data, Int) {
        var req = request(path)
        req.httpMethod = method
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, res) = try await session.data(for: req)
        store(res)
        return (data, (res as? HTTPURLResponse)?.statusCode ?? 0)
    }

    static func call<T: Decodable>(_ path: String, method: String = "GET", body: Any? = nil, as: T.Type = T.self) async throws -> T {
        let (data, status) = try await raw(path, method: method, body: body)
        guard (200..<300).contains(status) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError(message: msg ?? "Erreur \(status)", status: status)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func encode<T: Encodable>(_ v: T) -> Any { (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(v))) ?? [:] }
}

struct OK: Decodable {}

@MainActor
final class AppModel: ObservableObject {
    @Published var phase: Phase = .loading
    @Published var events: [AgendaEvent] = []
    @Published var chapters: [Chapter] = []
    @Published var profile: Profile?
    @Published var toast: String?
    @Published var offline = false
    @Published var schedule: Schedule?

    enum Phase { case loading, login, ready }
    private var poll: Timer?

    var name: String { profile?.name ?? "" }
    func isDone(_ e: AgendaEvent) -> Bool { profile?.done.contains(e.id) ?? false }
    func chapter(_ id: String) -> Chapter? { chapters.first { $0.id == id } }
    var courseSubjects: [String] {
        let have = Set(chapters.map(\.subject))
        return SUBJECTS.filter(have.contains) + have.subtracting(SUBJECTS).sorted()
    }
    func events(on day: String) -> [AgendaEvent] { ((schedule?.classes(on: day) ?? []) + events.filter { $0.date == day }).sorted { $0.sortKey < $1.sortKey } }
    func isCompanyDay(_ day: String) -> Bool { schedule?.isCompanyDay(day) ?? false }
    /// Le cours de la matière ce jour-là : un devoir s'y range automatiquement.
    func classFor(_ day: String, _ subject: String?) -> AgendaEvent? { schedule?.classes(on: day).first { sameSubject($0.subject, subject) } }
    func nextClasses(_ subject: String?, from: Date = Date(), count: Int = 4) -> [AgendaEvent] {
        var out: [AgendaEvent] = []
        for i in 0..<120 where out.count < count { if let c = classFor(iso(addDays(from, i)), subject) { out.append(c) } }
        return out
    }
    func inClass(_ e: AgendaEvent) -> Bool {
        !e.isClass && classFor(e.date, e.subject) != nil
    }
    // MARK: Révisions personnalisées (niveau 1–10 par matière, comme sur le site)
    struct RevisionPick: Hashable { var subject: String; var chapter: Chapter?; var why: String; var score: Double
        var label: String { "\(subject.components(separatedBy: " · ").first ?? subject) · \(chapter?.title ?? "reprendre le cours")" } }
    var revSubjects: [String] {
        var seen: [String] = []
        for c in schedule?.classes ?? [] where c.kind != "revision" && !seen.contains(c.subject) { seen.append(c.subject) }
        return seen
    }
    var hasLevels: Bool { !(profile?.levels ?? [:]).isEmpty }
    func levelOf(_ s: String) -> Int? { profile?.levels?.first { sameSubject($0.key, s) }?.value }
    static func levelWord(_ n: Int) -> String { n <= 3 ? "à reprendre" : n <= 5 ? "fragile" : n <= 7 ? "correct" : "solide" }
    private func saturday(_ day: String) -> Date { let wd = Schedule.weekday(day); return addDays(parseISO(day), wd == 0 ? -1 : 6 - wd) }
    func revisionPicks(_ day: String) -> [RevisionPick] {
        let sat = iso(saturday(day))
        let weekN = Int(floor(parseISO(sat).timeIntervalSince1970 / (7 * 86400)))
        var items: [RevisionPick] = [], seen = Set<String>()
        let deadlines = events.filter { ["eval", "examen", "devoir", "exercice"].contains($0.kind) && $0.date > sat && !isDone($0) }
        for s in revSubjects {
            let lvl = levelOf(s) ?? 5, weak = Double(11 - lvl) / 10
            let chs = chapters.filter { sameSubject($0.subject, s) }.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
            for e in deadlines where sameSubject(e.subject, s) {
                let days = daysBetween(sat, e.date)
                if days > 14 { continue }
                let linked = (e.chapters ?? []).compactMap(chapter)
                for ch in (linked.isEmpty ? [nil] : linked.map { Optional($0) }) {
                    let id = ch?.id ?? "s:\(s)\(e.id)"
                    if seen.contains(id) { continue }; seen.insert(id)
                    items.append(.init(subject: s, chapter: ch, why: "\(Kind.label(e.kind)) dans \(days) jour\(days > 1 ? "s" : "")", score: 4 + 3 * (1 - Double(days) / 14) + 2 * weak))
                }
            }
            let n = lvl <= 3 ? 3 : lvl <= 6 ? 2 : 1
            for i in 0..<n {
                let ch: Chapter? = chs.isEmpty ? nil : chs[(weekN * n + i) % chs.count]
                let id = ch?.id ?? "s:\(s)\(i)"
                if seen.contains(id) || (ch == nil && i > 0) { continue }; seen.insert(id)
                items.append(.init(subject: s, chapter: ch, why: "Niveau \(lvl)/10 · \(Self.levelWord(lvl))", score: 3 * weak - Double(i) * 0.3))
            }
        }
        return items.sorted { $0.score > $1.score }
    }
    func revisionFor(_ e: AgendaEvent) -> [RevisionPick] {
        guard e.revision == true, hasLevels else { return [] }
        let sat = saturday(e.date)
        let slots = [iso(sat), iso(addDays(sat, 1))].flatMap { (schedule?.classes(on: $0) ?? []).filter { $0.revision == true } }
        guard let i = slots.firstIndex(where: { $0.id == e.id }) else { return [] }
        return Array(revisionPicks(e.date).dropFirst(i * 2).prefix(2))
    }
    func saveLevels(_ levels: [String: Int]) async -> Bool {
        await run { profile = try await API.call("profile/levels", method: "PUT", body: ["levels": levels]) }
    }

    var pastHomework: [AgendaEvent] { let t = iso(Date()); return events.filter { $0.date < t && !($0.attachments ?? []).isEmpty }.sorted { $0.date > $1.date } }

    /// Joint une photo ou un PDF à un devoir (rangé avec le devoir, pas dans les cours).
    func attach(urls: [URL], to ev: AgendaEvent) async {
        _ = await run {
            let (data, name) = try PdfMaker.make(from: urls)
            struct Start: Decodable { var key: String; var uploadUrl: String }
            let s: Start = try await API.call("files/start", method: "POST", body: ["event": ev.id, "by": self.name, "name": name, "size": data.count])
            var req = URLRequest(url: URL(string: s.uploadUrl)!)
            req.httpMethod = "PUT"
            req.setValue("application/pdf", forHTTPHeaderField: "content-type")
            show("Envoi de \(fileSize(data.count))…")
            let (_, res) = try await API.session.upload(for: req, from: data)
            guard (res as? HTTPURLResponse)?.statusCode == 200 else { throw APIError(message: "Envoi impossible", status: 0) }
            let updated: AgendaEvent = try await API.call("files/finish", method: "POST", body: ["event": ev.id, "key": s.key, "name": name, "by": self.name])
            events.removeAll { $0.id == updated.id }
            events.append(updated)
            show("Fichier ajouté")
        }
    }

    func start() async {
        // Tests locaux uniquement : AGENDA_SITE=http://localhost:8888 AGENDA_TEST_LOGIN="prénom:code:motdepasse"
        let env = ProcessInfo.processInfo.environment
        if env["AGENDA_SITE"] != nil, let parts = env["AGENDA_TEST_LOGIN"]?.split(separator: ":").map(String.init), parts.count == 3 {
            _ = try? await API.raw("profile/login", method: "POST", body: ["name": parts[0], "pin": parts[1], "password": parts[2]])
        }
        do {
            profile = try await API.call("profile")
            phase = .ready
            await refresh()
            startPolling()
        } catch let e as APIError where e.status == 401 {
            phase = .login
        } catch {
            offline = true
            phase = .login
        }
    }

    func didLogin(_ p: Profile) async {
        profile = p
        UserDefaults.standard.set(p.name, forKey: "name")
        phase = .ready
        await refresh()
        startPolling()
        await Notifier.shared.requestIfNeeded(prefs: p.prefs)
    }

    func logout() async {
        _ = try? await API.raw("profile/logout", method: "POST")
        poll?.invalidate()
        profile = nil
        events = []
        chapters = []
        Notifier.shared.clear()
        phase = .login
    }

    func startPolling() {
        poll?.invalidate()
        poll = Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { [weak self] _ in
            Task { await self?.refresh() }
        }
    }

    func refresh() async {
        do {
            async let e: [AgendaEvent] = API.call("events")
            async let c: [Chapter] = API.call("chapters")
            let (ev, ch) = try await (e, c)
            if let (d, _) = try? await API.session.data(from: URL(string: "schedule.json", relativeTo: SITE)!), let s = try? JSONDecoder().decode(Schedule.self, from: d) { schedule = s }
            let previous = Set(events.map(\.id))
            let first = events.isEmpty
            events = ev
            chapters = ch.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
            if let p: Profile = try? await API.call("profile") { profile = p }
            offline = false
            if !first, let prefs = profile?.prefs, prefs.onNew {
                for n in ev where !previous.contains(n.id) && n.isDeadline && n.createdBy != name {
                    Notifier.shared.now(title: "Nouveau : \(Kind.label(n.kind).lowercased())", body: "\(n.title) · \(longDate(n.date))")
                }
            }
            Notifier.shared.schedule(events: events, profile: profile)
        } catch let e as APIError where e.status == 401 {
            phase = .login
        } catch {
            offline = true
        }
    }

    func show(_ msg: String) {
        toast = msg
        Task { try? await Task.sleep(for: .seconds(3)); if toast == msg { toast = nil } }
    }

    func run(_ action: () async throws -> Void) async -> Bool {
        do { try await action(); return true } catch { show(error.localizedDescription); return false }
    }

    // MARK: Événements
    func save(_ ev: AgendaEvent, isNew: Bool) async -> Bool {
        var body = API.encode(ev) as? [String: Any] ?? [:]
        body["by"] = name
        return await run {
            let saved: AgendaEvent = try await API.call(isNew ? "events" : "events/\(ev.id)", method: isNew ? "POST" : "PUT", body: body)
            events.removeAll { $0.id == saved.id }
            events.append(saved)
            show(isNew ? "Ajouté" : "Modifié")
        }
    }

    func delete(_ ev: AgendaEvent) async {
        _ = await run {
            let _: OK = try await API.call("events/\(ev.id)?by=\(name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")", method: "DELETE")
            events.removeAll { $0.id == ev.id }
            show("Supprimé")
        }
    }

    func toggleDone(_ ev: AgendaEvent) async {
        let done = !isDone(ev)
        if done { profile?.done.append(ev.id) } else { profile?.done.removeAll { $0 == ev.id } }
        _ = await run { profile = try await API.call("profile/done", method: "PUT", body: ["event": ev.id, "done": done]) }
    }

    // MARK: Chapitres et PDF
    func saveChapter(id: String?, subject: String, title: String) async -> Chapter? {
        var out: Chapter?
        _ = await run {
            let ch: Chapter = try await API.call(id == nil ? "chapters" : "chapters/\(id!)", method: id == nil ? "POST" : "PUT", body: ["subject": subject, "title": title, "by": name])
            chapters.removeAll { $0.id == ch.id }
            chapters.append(ch)
            out = ch
        }
        return out
    }

    func deleteChapter(_ ch: Chapter) async {
        _ = await run {
            let _: OK = try await API.call("chapters/\(ch.id)?by=\(name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")", method: "DELETE")
            chapters.removeAll { $0.id == ch.id }
            await refresh()
        }
    }

    func upload(urls: [URL], chapter: Chapter, slot: String) async {
        _ = await run {
            let (data, name) = try PdfMaker.make(from: urls)
            struct Start: Decodable { var key: String; var uploadUrl: String }
            let s: Start = try await API.call("files/start", method: "POST", body: ["chapter": chapter.id, "slot": slot, "by": self.name, "name": name, "size": data.count])
            var req = URLRequest(url: URL(string: s.uploadUrl)!)
            req.httpMethod = "PUT"
            req.setValue("application/pdf", forHTTPHeaderField: "content-type")
            show("Envoi de \(fileSize(data.count))…")
            let (_, res) = try await API.session.upload(for: req, from: data)
            guard (res as? HTTPURLResponse)?.statusCode == 200 else { throw APIError(message: "Envoi du PDF impossible", status: 0) }
            let ch: Chapter = try await API.call("files/finish", method: "POST", body: ["chapter": chapter.id, "slot": slot, "key": s.key, "name": name, "by": self.name])
            chapters.removeAll { $0.id == ch.id }
            chapters.append(ch)
            show("PDF ajouté")
        }
    }

    func deleteFile(_ f: PdfFile, chapter: Chapter, slot: String) async {
        _ = await run {
            let q = "chapter=\(chapter.id)&slot=\(slot)&by=\(name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"
            let ch: Chapter = try await API.call("files/\(f.key)?\(q)", method: "DELETE")
            chapters.removeAll { $0.id == ch.id }
            chapters.append(ch)
        }
    }

    func download(_ f: PdfFile) async throws -> URL {
        let (tmp, res) = try await API.session.download(for: API.request("files/\(f.key)"))
        guard (res as? HTTPURLResponse)?.statusCode == 200 else { throw APIError(message: "PDF indisponible", status: 0) }
        let dir = FileManager.default.temporaryDirectory.appending(path: "AgendaDCG/\(f.key)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appending(path: f.name)
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }

    // MARK: Profil
    func saveGrades(_ grades: [Grade]) async -> Bool {
        await run { profile = try await API.call("profile/grades", method: "PUT", body: ["grades": API.encode(grades)]) }
    }

    func savePrefs(_ prefs: Prefs) async {
        _ = await run {
            profile = try await API.call("profile/prefs", method: "PUT", body: ["prefs": API.encode(prefs)])
            await Notifier.shared.requestIfNeeded(prefs: prefs)
            Notifier.shared.schedule(events: events, profile: profile)
        }
    }
}

enum PdfMaker {
    /// Accepte des PDF ou des images (PNG, JPG, HEIC…) et renvoie un seul PDF.
    static func make(from urls: [URL]) throws -> (Data, String) {
        guard let first = urls.first else { throw APIError(message: "Aucun fichier", status: 0) }
        if urls.count == 1, first.pathExtension.lowercased() == "pdf" {
            let data = try Data(contentsOf: first)
            guard data.count <= 100 * 1024 * 1024 else { throw APIError(message: "PDF trop lourd (max 100 Mo)", status: 0) }
            return (data, first.lastPathComponent)
        }
        let doc = PDFDocument()
        for url in urls {
            if url.pathExtension.lowercased() == "pdf", let pdf = PDFDocument(url: url) {
                for i in 0..<pdf.pageCount { if let p = pdf.page(at: i) { doc.insert(p, at: doc.pageCount) } }
            } else if let img = NSImage(contentsOf: url), let page = PDFPage(image: img) {
                doc.insert(page, at: doc.pageCount)
            } else {
                throw APIError(message: "Fichier non pris en charge : \(url.lastPathComponent)", status: 0)
            }
        }
        guard let data = doc.dataRepresentation() else { throw APIError(message: "Conversion en PDF impossible", status: 0) }
        return (data, first.deletingPathExtension().lastPathComponent + ".pdf")
    }
}

/// Rappels locaux calculés sur l'appareil (même logique que les notifications du site).
final class Notifier: @unchecked Sendable {
    static let shared = Notifier()
    private var center: UNUserNotificationCenter? { Bundle.main.bundleIdentifier == nil ? nil : .current() }

    func requestIfNeeded(prefs: Prefs) async {
        guard prefs.daily || prefs.weekly || prefs.onNew || !prefs.before.isEmpty else { return }
        _ = try? await center?.requestAuthorization(options: [.alert, .sound, .badge])
    }

    func clear() { center?.removeAllPendingNotificationRequests() }

    func now(title: String, body: String) {
        let c = UNMutableNotificationContent()
        c.title = title; c.body = body; c.sound = .default
        center?.add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
    }

    @MainActor
    func schedule(events: [AgendaEvent], profile: Profile?) {
        guard let center, let profile else { return }
        center.removeAllPendingNotificationRequests()
        let prefs = profile.prefs
        let today = iso(Date())
        let todo = events.filter { $0.isDeadline && !profile.done.contains($0.id) && $0.date >= today }
        func add(_ id: String, day: String, hour: Int, title: String, body: String) {
            var dc = cal.dateComponents([.year, .month, .day], from: parseISO(day))
            dc.hour = hour
            guard let when = cal.date(from: dc), when > Date() else { return }
            let c = UNMutableNotificationContent()
            c.title = title; c.body = body; c.sound = .default
            center.add(UNNotificationRequest(identifier: id, content: c, trigger: UNCalendarNotificationTrigger(dateMatching: dc, repeats: false)))
        }
        if prefs.daily {
            for i in 0..<14 {
                let day = iso(addDays(Date(), i))
                let list = events.filter { $0.date == day }
                guard !list.isEmpty else { continue }
                add("daily-\(day)", day: day, hour: 7, title: "Aujourd'hui", body: list.map { ($0.time.map { $0.isEmpty ? "" : "\($0) " } ?? "") + $0.title }.joined(separator: " · "))
            }
        }
        for d in prefs.before {
            for e in todo {
                let day = iso(addDays(parseISO(e.date), -d))
                add("before-\(d)-\(e.id)", day: day, hour: 19, title: d == 1 ? "Demain" : "Dans \(d) jours", body: "\(Kind.label(e.kind)) : \(e.title)")
            }
        }
        if prefs.weekly {
            for w in 0..<4 {
                var sunday = addDays(mondayOf(Date()), 6 + 7 * w)
                if iso(sunday) < today { sunday = addDays(sunday, 7) }
                let from = iso(addDays(sunday, 1)), to = iso(addDays(sunday, 7))
                let n = todo.filter { $0.date >= from && $0.date <= to }.count
                add("weekly-\(iso(sunday))", day: iso(sunday), hour: 18, title: "Ta semaine", body: n == 0 ? "Rien à rendre la semaine prochaine." : "\(n) échéance\(n > 1 ? "s" : "") la semaine prochaine.")
            }
        }
    }
}
