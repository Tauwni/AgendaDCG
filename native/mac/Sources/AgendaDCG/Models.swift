import SwiftUI

let SITE = URL(string: ProcessInfo.processInfo.environment["AGENDA_SITE"] ?? "https://agendadcg.netlify.app")!

struct HistoryEntry: Codable, Hashable { var by: String?; var at: String?; var action: String? }

struct AgendaEvent: Codable, Identifiable, Hashable {
    var id: String
    var kind: String
    var title: String
    var subject: String?
    var date: String
    var time: String?
    var color: String?
    var notes: String?
    var chapters: [String]?
    var createdBy: String?
    var updatedBy: String?
    var updatedAt: String?
    var history: [HistoryEntry]?
    var end: String?

    var isDeadline: Bool { Kind.deadline.contains(kind) }
    var isClass: Bool { id.hasPrefix("edt:") }
    var timeLabel: String? { guard let t = time, !t.isEmpty else { return nil }; return end.map { "\(t)–\($0)" } ?? t }
    var sortKey: String { date + (time ?? "") }
}

/// Emploi du temps fixe, lu dans public/schedule.json (modifiable sans mettre à jour l'app).
struct Schedule: Codable {
    struct Slot: Codable { var day: Int; var start: String; var end: String; var subject: String; var title: String; var color: String }
    var classes: [Slot]
    var companyDays: [Int]
    var from: String?
    var to: String?
    var skip: [String]?

    func inTerm(_ day: String) -> Bool {
        (from.map { day >= $0 } ?? true) && (to.map { day <= $0 } ?? true) && !(skip ?? []).contains(day) && holiday(day) == nil
    }
    /// jour de semaine façon JavaScript : 0 = dimanche … 6 = samedi
    static func weekday(_ day: String) -> Int { cal.component(.weekday, from: parseISO(day)) - 1 }
    func classes(on day: String) -> [AgendaEvent] {
        guard inTerm(day) else { return [] }
        return classes.enumerated().filter { $0.element.day == Self.weekday(day) }.map { i, c in
            AgendaEvent(id: "edt:\(day):\(i)", kind: "cours", title: c.title, subject: c.subject, date: day, time: c.start, color: c.color, notes: nil, chapters: [], end: c.end)
        }
    }
    func isCompanyDay(_ day: String) -> Bool { inTerm(day) && companyDays.contains(Self.weekday(day)) }
}

let REVISE_URL = URL(string: "https://objectif-dcg.netlify.app/")!

struct PdfFile: Codable, Hashable { var key: String; var name: String; var size: Int?; var uploadedBy: String?; var uploadedAt: String? }

struct Chapter: Codable, Identifiable, Hashable {
    var id: String
    var subject: String
    var title: String
    var files: [String: PdfFile?]
    var updatedBy: String?
    var updatedAt: String?
    func file(_ slot: String) -> PdfFile? { files[slot] ?? nil }
}

struct Grade: Codable, Identifiable, Hashable {
    var id: String
    var subject: String
    var title: String
    var date: String
    var category: String
    var value: Double
    var outOf: Double
    var coef: Double
    var on20: Double { outOf > 0 ? value / outOf * 20 : 0 }
}

struct Prefs: Codable, Hashable { var onNew = false; var daily = false; var weekly = false; var before: [Int] = [] }

struct Profile: Codable, Hashable {
    var id: String
    var name: String
    var done: [String]
    var grades: [Grade]
    var prefs: Prefs
}

enum Kind {
    static let all: [(id: String, label: String, icon: String)] = [
        ("eval", "Évaluation", "checklist"),
        ("examen", "Examen blanc", "timer"),
        ("devoir", "Devoir", "pencil"),
        ("exercice", "Exercice", "book"),
        ("cours", "Cours", "graduationcap"),
        ("revision", "Révision", "arrow.clockwise"),
        ("autre", "Autre", "ellipsis"),
    ]
    static let deadline: Set<String> = ["eval", "examen", "devoir", "exercice"]
    static func label(_ k: String) -> String { all.first { $0.id == k }?.label ?? "Évaluation" }
    static func icon(_ k: String) -> String { all.first { $0.id == k }?.icon ?? "checklist" }
}

let SLOTS: [(id: String, label: String)] = [("cours", "Fiche de cours"), ("sujet", "Sujet type"), ("corrige", "Corrigé"), ("topexo", "TOP EXO")]
let CATEGORIES: [(id: String, label: String)] = [("controle", "Contrôle UFA"), ("devoir", "Devoir"), ("examen", "Examen blanc"), ("entrainement", "Entraînement")]
let SUBJECTS = [
    "UE1 · Fondamentaux du droit", "UE2 · Droit des sociétés", "UE3 · Droit social", "UE4 · Droit fiscal",
    "UE5 · Économie contemporaine", "UE6 · Finance d'entreprise", "UE7 · Management", "UE8 · Systèmes d'information de gestion",
    "UE9 · Introduction à la comptabilité", "UE10 · Comptabilité approfondie", "UE11 · Contrôle de gestion",
    "UE12 · Anglais appliqué aux affaires", "UE13 · Communication professionnelle",
]
let COLOR_NAMES = ["red", "orange", "yellow", "green", "blue", "purple", "brown"]

func eventColor(_ name: String?) -> Color {
    switch name {
    case "red": .red
    case "orange": .orange
    case "yellow": .yellow
    case "green": .green
    case "purple": .purple
    case "brown": .brown
    default: .blue
    }
}

// MARK: - Dates (ISO "yyyy-MM-dd", calendrier local)

let cal: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.locale = Locale(identifier: "fr_FR")
    c.firstWeekday = 2
    return c
}()

let MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
let DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"]

func iso(_ d: Date) -> String {
    let c = cal.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}

func parseISO(_ s: String) -> Date {
    let p = s.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3 else { return Date() }
    return cal.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))!
}

func addDays(_ d: Date, _ n: Int) -> Date { cal.date(byAdding: .day, value: n, to: d)! }
func startOfMonth(_ d: Date) -> Date { cal.date(from: cal.dateComponents([.year, .month], from: d))! }
func mondayOf(_ d: Date) -> Date { addDays(cal.startOfDay(for: d), -((cal.component(.weekday, from: d) + 5) % 7)) }
func daysBetween(_ a: String, _ b: String) -> Int { cal.dateComponents([.day], from: parseISO(a), to: parseISO(b)).day ?? 0 }

func longDate(_ s: String) -> String {
    let d = parseISO(s)
    return "\(DAYS[cal.component(.weekday, from: d) - 1]) \(cal.component(.day, from: d)) \(MONTHS[cal.component(.month, from: d) - 1])"
}
func monthTitle(_ d: Date) -> String { "\(MONTHS[cal.component(.month, from: d) - 1].capitalized) \(cal.component(.year, from: d))" }
func relativeDay(_ s: String) -> String {
    let n = daysBetween(iso(Date()), s)
    switch n {
    case 0: return "Aujourd'hui"
    case 1: return "Demain"
    case -1: return "Hier"
    case 2...6: return "Dans \(n) jours"
    default: return longDate(s).capitalized
    }
}

func fr(_ n: Double, _ digits: Int = 1) -> String {
    let f = NumberFormatter()
    f.locale = Locale(identifier: "fr_FR")
    f.maximumFractionDigits = digits
    f.minimumFractionDigits = 0
    return f.string(from: NSNumber(value: n)) ?? "\(n)"
}

func fileSize(_ n: Int) -> String { n > 1_048_576 ? "\(fr(Double(n) / 1_048_576)) Mo" : "\(max(1, n / 1024)) Ko" }

private var holidayCache: [Int: [String: String]] = [:]
func holiday(_ date: String) -> String? {
    let year = Int(date.prefix(4)) ?? 2000
    if let h = holidayCache[year] { return h[date] }
    let a = year % 19, b = year / 100, c = year % 100, d = b / 4, e = b % 4
    let f = (b + 8) / 25, g = (b - f + 1) / 3, h = (19 * a + b - d - g + 15) % 30
    let i = c / 4, k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = (a + 11 * h + 22 * l) / 451
    let month = (h + l - 7 * m + 114) / 31, day = (h + l - 7 * m + 114) % 31 + 1
    let easter = cal.date(from: DateComponents(year: year, month: month, day: day))!
    let y = String(year)
    let list = [
        "\(y)-01-01": "Jour de l'an", iso(addDays(easter, 1)): "Lundi de Pâques", "\(y)-05-01": "Fête du Travail",
        "\(y)-05-08": "Victoire 1945", iso(addDays(easter, 39)): "Ascension", iso(addDays(easter, 50)): "Lundi de Pentecôte",
        "\(y)-07-14": "Fête nationale", "\(y)-08-15": "Assomption", "\(y)-11-01": "Toussaint",
        "\(y)-11-11": "Armistice 1918", "\(y)-12-25": "Noël",
    ]
    holidayCache[year] = list
    return list[date]
}

func weightedAverage(_ list: [Grade]) -> Double? {
    let c = list.filter { $0.category != "entrainement" }
    let coefs = c.reduce(0) { $0 + $1.coef }
    return coefs > 0 ? c.reduce(0) { $0 + $1.on20 * $1.coef } / coefs : nil
}
