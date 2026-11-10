import SwiftUI

// MARK: - Carte d'événement

struct EventRow: View {
    @EnvironmentObject var model: AppModel
    let event: AgendaEvent
    var showDate = false
    @State private var detail = false

    var body: some View {
        let done = model.isDone(event)
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2).fill(eventColor(event.color)).frame(width: 4)
            Image(systemName: Kind.icon(event.kind)).foregroundStyle(eventColor(event.color)).frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title).font(.body.weight(.semibold)).strikethrough(done).foregroundStyle(done ? .secondary : .primary)
                Text(meta).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            if event.isDeadline {
                Button { Task { await model.toggleDone(event) } } label: {
                    Image(systemName: done ? "checkmark.circle.fill" : "circle").font(.title2)
                        .foregroundStyle(done ? Color.green : Color.secondary)
                }
                .buttonStyle(.plain)
                .help(done ? "Marquer à faire" : "Marquer fait")
            }
        }
        .padding(10)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 10))
        .contentShape(Rectangle())
        .onTapGesture { detail = true }
        .sheet(isPresented: $detail) { EventDetail(event: model.events.first { $0.id == event.id } ?? event) }
    }

    var meta: String {
        var parts = [Kind.label(event.kind)]
        if showDate { parts.append(relativeDay(event.date)) }
        if let t = event.time, !t.isEmpty { parts.append(t) }
        if let s = event.subject, !s.isEmpty { parts.append(s) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Aujourd'hui

struct TodayView: View {
    @EnvironmentObject var model: AppModel
    @State private var adding = false

    var body: some View {
        let today = iso(Date())
        let todays = model.events(on: today)
        let upcoming = model.events.filter { $0.isDeadline && $0.date > today && daysBetween(today, $0.date) <= 21 }.sorted { $0.sortKey < $1.sortKey }
        let late = model.events.filter { $0.isDeadline && $0.date < today && daysBetween($0.date, today) <= 14 && !model.isDone($0) }
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(longDate(today).capitalized).font(.title3).foregroundStyle(.secondary)
                    Text("\(greeting), \(model.name)").font(.largeTitle.bold())
                }
                if let h = holiday(today) { Label("Jour férié : \(h)", systemImage: "sun.max").foregroundStyle(.orange) }
                section("Aujourd'hui", todays, empty: "Rien de prévu aujourd'hui.")
                if !late.isEmpty { section("Pas encore fait", late, showDate: true) }
                section("À venir", upcoming, empty: "Aucune échéance dans les 3 prochaines semaines.", showDate: true)
            }
            .padding(28)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .toolbar { Button { adding = true } label: { Label("Ajouter", systemImage: "plus") } }
        .sheet(isPresented: $adding) { EventEditor(event: nil, date: today) }
    }

    var greeting: String {
        let h = cal.component(.hour, from: Date())
        return h < 18 && h >= 5 ? "Bonjour" : "Bonsoir"
    }

    @ViewBuilder func section(_ title: String, _ list: [AgendaEvent], empty: String = "", showDate: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title2.bold())
            if list.isEmpty { Text(empty).foregroundStyle(.secondary) }
            ForEach(list) { EventRow(event: $0, showDate: showDate) }
        }
    }
}

// MARK: - Agenda

struct AgendaView: View {
    @EnvironmentObject var model: AppModel
    @AppStorage("view") private var view = "month"
    @State private var month = startOfMonth(Date())
    @State private var week = mondayOf(Date())
    @State private var selected = iso(Date())
    @State private var direction: Edge = .trailing
    @State private var adding = false
    @State private var picker = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            Group {
                if view == "month" { MonthGrid(month: month, selected: $selected).id(iso(month)) }
                else { WeekColumns(week: week, selected: $selected).id(iso(week)) }
            }
            .transition(.asymmetric(insertion: .move(edge: direction).combined(with: .opacity), removal: .move(edge: direction == .trailing ? .leading : .trailing).combined(with: .opacity)))
            .frame(maxHeight: .infinity)
            .clipped()
            .background(TrackpadSwipe { go($0) })
            if view == "month" {
                Divider()
                DayList(day: selected).frame(height: 220)
            }
        }
        .toolbar {
            ToolbarItem {
                Picker("Vue", selection: $view) { Text("Mois").tag("month"); Text("Semaine").tag("week") }.pickerStyle(.segmented)
            }
            ToolbarItem { Button { adding = true } label: { Label("Ajouter", systemImage: "plus") } }
        }
        .sheet(isPresented: $adding) { EventEditor(event: nil, date: selected) }
        .onChange(of: view) { _, v in
            if v == "week" { week = mondayOf(parseISO(selected)) } else { month = startOfMonth(parseISO(selected)) }
        }
        .onKeyPress(.leftArrow) { go(-1); return .handled }
        .onKeyPress(.rightArrow) { go(1); return .handled }
        .focusable()
        .focusEffectDisabled()
    }

    var header: some View {
        HStack {
            Button { picker.toggle() } label: {
                HStack(spacing: 4) {
                    Text(view == "month" ? monthTitle(month) : weekTitle).font(.title.bold())
                    Image(systemName: "chevron.down").font(.callout)
                }
            }
            .buttonStyle(.plain)
            .popover(isPresented: $picker) { MonthPicker(month: month) { m in jump(to: m); picker = false } }
            Spacer()
            Button("Aujourd'hui") { jump(to: Date()) }
            Button { go(-1) } label: { Image(systemName: "chevron.left") }
            Button { go(1) } label: { Image(systemName: "chevron.right") }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
    }

    var weekTitle: String {
        let end = addDays(week, 6)
        let w = cal.component(.weekOfYear, from: week)
        return "Semaine \(w) · \(cal.component(.day, from: week)) – \(cal.component(.day, from: end)) \(MONTHS[cal.component(.month, from: end) - 1])"
    }

    func go(_ step: Int) {
        direction = step > 0 ? .trailing : .leading
        withAnimation(.spring(duration: 0.4)) {
            if view == "month" { month = cal.date(byAdding: .month, value: step, to: month)! }
            else { week = addDays(week, 7 * step) }
        }
    }

    func jump(to d: Date) {
        direction = d < (view == "month" ? month : week) ? .leading : .trailing
        withAnimation(.spring(duration: 0.4)) {
            month = startOfMonth(d)
            week = mondayOf(d)
            selected = iso(d)
        }
    }
}

struct MonthPicker: View {
    let month: Date
    let pick: (Date) -> Void
    @State private var year = 0
    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Button { year -= 1 } label: { Image(systemName: "chevron.left") }
                Text(String(year)).font(.headline).frame(maxWidth: .infinity)
                Button { year += 1 } label: { Image(systemName: "chevron.right") }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(80)), count: 3)) {
                ForEach(0..<12) { m in
                    Button(MONTHS[m].capitalized) { pick(cal.date(from: DateComponents(year: year, month: m + 1, day: 1))!) }
                        .buttonStyle(.bordered)
                        .tint(m + 1 == cal.component(.month, from: month) && year == cal.component(.year, from: month) ? .red : nil)
                }
            }
        }
        .padding()
        .onAppear { year = cal.component(.year, from: month) }
    }
}

struct MonthGrid: View {
    @EnvironmentObject var model: AppModel
    let month: Date
    @Binding var selected: String

    var body: some View {
        let offset = (cal.component(.weekday, from: month) + 5) % 7
        let count = cal.range(of: .day, in: .month, for: month)!.count
        let rows = Int(ceil(Double(offset + count) / 7))
        let today = iso(Date())
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."], id: \.self) {
                    Text($0).font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                }
            }
            .padding(.vertical, 6)
            GeometryReader { geo in
                VStack(spacing: 0) {
                    ForEach(0..<rows, id: \.self) { r in
                        HStack(spacing: 0) {
                            ForEach(0..<7, id: \.self) { c in
                                let n = r * 7 + c - offset + 1
                                if n >= 1 && n <= count {
                                    let day = iso(addDays(month, n - 1))
                                    DayCell(day: day, n: n, isToday: day == today, isSelected: day == selected, weekend: c >= 5)
                                        .onTapGesture { selected = day }
                                } else {
                                    Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
                                }
                            }
                        }
                        .frame(height: geo.size.height / CGFloat(rows))
                    }
                }
            }
        }
        .padding(.horizontal, 8)
    }
}

struct DayCell: View {
    @EnvironmentObject var model: AppModel
    let day: String, n: Int, isToday: Bool, isSelected: Bool, weekend: Bool

    var body: some View {
        let list = model.events(on: day)
        let h = holiday(day)
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("\(n)").font(.callout.weight(isToday ? .bold : .regular))
                    .foregroundStyle(isToday ? .white : (weekend || h != nil) ? .secondary : .primary)
                    .frame(width: 24, height: 24)
                    .background(isToday ? Color.red : .clear, in: Circle())
                if let h { Text(h).font(.caption2).foregroundStyle(.orange).lineLimit(1) }
            }
            ForEach(list.prefix(3)) { e in
                Text(e.title).font(.caption2).lineLimit(1)
                    .padding(.horizontal, 4).padding(.vertical, 1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(eventColor(e.color).opacity(model.isDone(e) ? 0.08 : 0.2), in: RoundedRectangle(cornerRadius: 4))
                    .strikethrough(model.isDone(e))
            }
            if list.count > 3 { Text("+\(list.count - 3)").font(.caption2).foregroundStyle(.secondary) }
            Spacer(minLength: 0)
        }
        .padding(4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(isSelected ? Color.accentColor.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 8))
        .overlay(alignment: .top) { Rectangle().fill(.separator).frame(height: 0.5) }
        .contentShape(Rectangle())
    }
}

struct DayList: View {
    @EnvironmentObject var model: AppModel
    let day: String
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(longDate(day).capitalized).font(.headline)
                if let h = holiday(day) { Label(h, systemImage: "sun.max").foregroundStyle(.orange).font(.callout) }
                let list = model.events(on: day)
                if list.isEmpty { Text("Rien ce jour-là.").foregroundStyle(.secondary) }
                ForEach(list) { EventRow(event: $0) }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct WeekColumns: View {
    @EnvironmentObject var model: AppModel
    let week: Date
    @Binding var selected: String
    @State private var adding: String?

    var body: some View {
        let today = iso(Date())
        HStack(alignment: .top, spacing: 8) {
            ForEach(0..<7, id: \.self) { i in
                let d = addDays(week, i)
                let day = iso(d)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(DAYS[cal.component(.weekday, from: d) - 1].prefix(3) + ".").font(.caption).foregroundStyle(.secondary)
                        Text("\(cal.component(.day, from: d))").font(.title3.bold())
                            .foregroundStyle(day == today ? .red : .primary)
                    }
                    if let h = holiday(day) { Text(h).font(.caption2).foregroundStyle(.orange) }
                    ScrollView {
                        VStack(spacing: 6) {
                            ForEach(model.events(on: day)) { WeekEvent(event: $0) }
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(8)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(day == today ? Color.red.opacity(0.06) : Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
                .contentShape(Rectangle())
                .onTapGesture(count: 2) { adding = day }
                .onTapGesture { selected = day }
            }
        }
        .padding(12)
        .sheet(item: Binding(get: { adding.map { IdString(id: $0) } }, set: { adding = $0?.id })) { EventEditor(event: nil, date: $0.id) }
    }
}

struct IdString: Identifiable { var id: String }

struct WeekEvent: View {
    @EnvironmentObject var model: AppModel
    let event: AgendaEvent
    @State private var detail = false
    var body: some View {
        let done = model.isDone(event)
        VStack(alignment: .leading, spacing: 2) {
            if let t = event.time, !t.isEmpty { Text(t).font(.caption2.bold()) }
            Text(event.title).font(.caption.weight(.semibold)).strikethrough(done)
            Text(Kind.label(event.kind)).font(.caption2).foregroundStyle(.secondary)
        }
        .padding(6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(eventColor(event.color).opacity(done ? 0.08 : 0.2), in: RoundedRectangle(cornerRadius: 6))
        .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(eventColor(event.color)).frame(width: 3) }
        .onTapGesture { detail = true }
        .sheet(isPresented: $detail) { EventDetail(event: model.events.first { $0.id == event.id } ?? event) }
    }
}

/// Balayage à deux doigts sur le trackpad pour changer de mois / semaine.
struct TrackpadSwipe: NSViewRepresentable {
    let onSwipe: (Int) -> Void
    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        context.coordinator.view = v
        context.coordinator.monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { e in
            context.coordinator.handle(e)
            return e
        }
        return v
    }
    func updateNSView(_ nsView: NSView, context: Context) { context.coordinator.onSwipe = onSwipe }
    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        if let m = coordinator.monitor { NSEvent.removeMonitor(m) }
    }
    func makeCoordinator() -> Coordinator { Coordinator(onSwipe: onSwipe) }

    final class Coordinator {
        var onSwipe: (Int) -> Void
        weak var view: NSView?
        var monitor: Any?
        var dx: CGFloat = 0
        var fired = false
        init(onSwipe: @escaping (Int) -> Void) { self.onSwipe = onSwipe }

        func handle(_ e: NSEvent) {
            guard let view, let win = view.window, e.window == win,
                  view.bounds.contains(view.convert(e.locationInWindow, from: nil)), e.hasPreciseScrollingDeltas else { return }
            if e.phase == .began { dx = 0; fired = false }
            if e.phase == .changed || e.phase == .began {
                guard abs(e.scrollingDeltaX) > abs(e.scrollingDeltaY) else { return }
                dx += e.scrollingDeltaX
                if !fired && abs(dx) > 90 {
                    fired = true
                    onSwipe(dx > 0 ? -1 : 1)
                }
            }
            if e.phase == .ended || e.phase == .cancelled { dx = 0 }
        }
    }
}

// MARK: - Détail et édition

struct EventDetail: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let event: AgendaEvent
    @State private var editing = false
    @State private var confirm = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label(Kind.label(event.kind), systemImage: Kind.icon(event.kind)).foregroundStyle(eventColor(event.color))
                Spacer()
                Button("Fermer") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text(event.title).font(.title.bold())
            VStack(alignment: .leading, spacing: 4) {
                Label(longDate(event.date).capitalized + ((event.time ?? "").isEmpty ? "" : " à \(event.time!)"), systemImage: "calendar")
                if let s = event.subject, !s.isEmpty { Label(s, systemImage: "book.closed") }
            }
            .foregroundStyle(.secondary)
            if let n = event.notes, !n.isEmpty { Text(n).textSelection(.enabled) }
            let chs = (event.chapters ?? []).compactMap(model.chapter)
            if !chs.isEmpty {
                Text("Chapitres").font(.headline)
                ForEach(chs) { ch in ChapterFiles(chapter: ch) }
            }
            if event.isDeadline {
                Button { Task { await model.toggleDone(event) } } label: {
                    Label(model.isDone(event) ? "Fait ✓" : "Marquer comme fait", systemImage: model.isDone(event) ? "checkmark.circle.fill" : "circle")
                }
            }
            if let by = event.updatedBy { Text("Modifié par \(by)").font(.caption).foregroundStyle(.secondary) }
            Spacer()
            HStack {
                Button("Supprimer", role: .destructive) { confirm = true }
                Spacer()
                Button("Modifier") { editing = true }.buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
        .frame(width: 480, height: 520)
        .sheet(isPresented: $editing) { EventEditor(event: event, date: event.date) }
        .confirmationDialog("Supprimer « \(event.title) » pour toute la classe ?", isPresented: $confirm) {
            Button("Supprimer", role: .destructive) { Task { await model.delete(event); dismiss() } }
        }
    }
}

struct EventEditor: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let isNew: Bool
    @State private var ev: AgendaEvent
    @State private var hasTime: Bool
    @State private var time: Date

    init(event: AgendaEvent?, date: String) {
        isNew = event == nil
        let e = event ?? AgendaEvent(id: "", kind: "eval", title: "", subject: "", date: date, time: "", color: "blue", notes: "", chapters: [])
        _ev = State(initialValue: e)
        _hasTime = State(initialValue: !(e.time ?? "").isEmpty)
        let p = (e.time ?? "").split(separator: ":").compactMap { Int($0) }
        _time = State(initialValue: cal.date(bySettingHour: p.first ?? 9, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date())!)
    }

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Picker("Type", selection: $ev.kind) {
                    ForEach(Kind.all, id: \.id) { Label($0.label, systemImage: $0.icon).tag($0.id) }
                }
                TextField("Titre", text: $ev.title)
                Picker("Matière", selection: Binding(get: { ev.subject ?? "" }, set: { ev.subject = $0; ev.chapters = [] })) {
                    Text("Aucune").tag("")
                    ForEach(subjects, id: \.self) { Text($0).tag($0) }
                }
                DatePicker("Date", selection: Binding(get: { parseISO(ev.date) }, set: { ev.date = iso($0) }), displayedComponents: .date)
                Toggle("Heure précise", isOn: $hasTime)
                if hasTime { DatePicker("Heure", selection: $time, displayedComponents: .hourAndMinute) }
                Picker("Couleur", selection: Binding(get: { ev.color ?? "blue" }, set: { ev.color = $0 })) {
                    ForEach(COLOR_NAMES, id: \.self) { c in
                        Image(systemName: "circle.fill").foregroundStyle(eventColor(c)).tag(c)
                    }
                }
                .pickerStyle(.segmented)
                let chs = model.chapters.filter { $0.subject == ev.subject }
                if !chs.isEmpty {
                    Section("Chapitres concernés") {
                        ForEach(chs) { ch in
                            Toggle(ch.title, isOn: Binding(
                                get: { ev.chapters?.contains(ch.id) ?? false },
                                set: { on in ev.chapters = (ev.chapters ?? []).filter { $0 != ch.id } + (on ? [ch.id] : []) }))
                        }
                    }
                }
                Section("Notes") { TextEditor(text: Binding(get: { ev.notes ?? "" }, set: { ev.notes = $0 })).frame(height: 70) }
            }
            .formStyle(.grouped)
            HStack {
                Button("Annuler") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button(isNew ? "Ajouter" : "Enregistrer") {
                    if hasTime {
                        let c = cal.dateComponents([.hour, .minute], from: time)
                        ev.time = String(format: "%02d:%02d", c.hour!, c.minute!)
                    } else { ev.time = "" }
                    Task { if await model.save(ev, isNew: isNew) { dismiss() } }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(ev.title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding()
        }
        .frame(width: 500, height: 620)
    }

    var subjects: [String] {
        var s = model.courseSubjects
        if let cur = ev.subject, !cur.isEmpty, !s.contains(cur) { s.append(cur) }
        return s
    }
}
