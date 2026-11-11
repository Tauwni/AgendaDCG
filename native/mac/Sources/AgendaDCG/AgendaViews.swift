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
        .sheet(isPresented: $detail) { if event.isClass { ClassDetail(event: event) } else { EventDetail(event: model.events.first { $0.id == event.id } ?? event) } }
    }

    var meta: String {
        var parts = [Kind.label(event.kind)]
        if showDate { parts.append(relativeDay(event.date)) }
        if let t = event.timeLabel { parts.append(t) }
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
                else if model.isCompanyDay(today) { Label("Journée en entreprise", systemImage: "briefcase").foregroundStyle(.secondary) }
                section("Aujourd'hui", todays, empty: model.isCompanyDay(today) ? "Journée en entreprise, pas de cours." : "Rien de prévu aujourd'hui.")
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
        if view == "cahier" {
            CahierView()
                .toolbar {
                    ToolbarItem { viewPicker }
                    ToolbarItem { Button { adding = true } label: { Label("Ajouter", systemImage: "plus") } }
                }
                .sheet(isPresented: $adding) { EventEditor(event: nil, date: iso(addDays(Date(), 1)), kind: "devoir") }
        } else {
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
            ToolbarItem { viewPicker }
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
    }

    var viewPicker: some View {
        Picker("Vue", selection: $view) { Text("Mois").tag("month"); Text("Semaine").tag("week"); Text("Cahier").tag("cahier") }.pickerStyle(.segmented)
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
                else if model.isCompanyDay(day) { Text("Entreprise").font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
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
                else if model.isCompanyDay(day) { Label("Journée en entreprise", systemImage: "briefcase").foregroundStyle(.secondary).font(.callout) }
                let list = model.events(on: day)
                if list.isEmpty { Text("Rien ce jour-là.").foregroundStyle(.secondary) }
                ForEach(list) { EventRow(event: $0) }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Semaine façon emploi du temps (ENT) : grille horaire 8 h – 19 h.
struct WeekColumns: View {
    @EnvironmentObject var model: AppModel
    let week: Date
    @Binding var selected: String
    @State private var adding: String?
    @State private var detail: AgendaEvent?
    private let startH = 8, endH = 19

    static func minutes(_ t: String) -> Int { let p = t.split(separator: ":").compactMap { Int($0) }; return (p.first ?? 0) * 60 + (p.count > 1 ? p[1] : 0) }

    var body: some View {
        let today = iso(Date())
        let days = (0..<7).map { iso(addDays(week, $0)) }.enumerated().filter { $0.offset < 5 || !model.events(on: $0.element).isEmpty }.map(\.element)
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                Text("").frame(width: 44)
                ForEach(days, id: \.self) { day in
                    let d = parseISO(day)
                    VStack(spacing: 2) {
                        Text(DAYS[cal.component(.weekday, from: d) - 1].prefix(3) + ".").font(.caption).foregroundStyle(.secondary)
                        Text("\(cal.component(.day, from: d))").font(.title3.weight(.semibold))
                            .foregroundStyle(day == today ? .white : .primary)
                            .frame(width: 32, height: 32)
                            .background(day == today ? Color.red : .clear, in: Circle())
                    }
                    .frame(maxWidth: .infinity)
                    .onTapGesture { selected = day }
                }
            }
            HStack(alignment: .top, spacing: 4) {
                Text("Journée").font(.caption2).foregroundStyle(.secondary).frame(width: 44, alignment: .trailing)
                ForEach(days, id: \.self) { day in
                    VStack(spacing: 3) {
                        ForEach(model.events(on: day).filter { ($0.time ?? "").isEmpty && !model.inClass($0) }) { e in
                            Label(e.title, systemImage: Kind.icon(e.kind)).font(.caption.weight(.semibold)).lineLimit(1)
                                .padding(.horizontal, 6).padding(.vertical, 3)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(eventColor(e.color).opacity(0.2), in: RoundedRectangle(cornerRadius: 6))
                                .strikethrough(model.isDone(e)).opacity(model.isDone(e) ? 0.5 : 1)
                                .onTapGesture { detail = e }
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 24, alignment: .top)
                }
            }
            .padding(.vertical, 4)
            Divider()
            GeometryReader { geo in
                let hourH = max(40, geo.size.height / CGFloat(endH - startH))
                ScrollView {
                    HStack(alignment: .top, spacing: 4) {
                        VStack(spacing: 0) {
                            ForEach(startH..<endH, id: \.self) { h in
                                Text("\(h) h").font(.caption2).foregroundStyle(.secondary).frame(width: 44, height: hourH, alignment: .topTrailing).offset(y: -6)
                            }
                        }
                        ForEach(days, id: \.self) { day in column(day, hourH: hourH, today: today) }
                    }
                    .padding(.top, 6)
                }
            }
        }
        .padding(.horizontal, 12)
        .sheet(item: Binding(get: { adding.map { IdString(id: $0) } }, set: { adding = $0?.id })) { EventEditor(event: nil, date: $0.id) }
        .sheet(item: $detail) { e in if e.isClass { ClassDetail(event: e) } else { EventDetail(event: model.events.first { $0.id == e.id } ?? e) } }
    }

    @ViewBuilder func column(_ day: String, hourH: CGFloat, today: String) -> some View {
        let inside = model.events(on: day).filter { model.inClass($0) }
        let timed = model.events(on: day).filter { !($0.time ?? "").isEmpty && !model.inClass($0) }
        let note = holiday(day) ?? (model.isCompanyDay(day) && timed.isEmpty ? "Entreprise" : nil)
        ZStack(alignment: .topLeading) {
            VStack(spacing: 0) {
                ForEach(startH..<endH, id: \.self) { _ in Rectangle().fill(.clear).frame(height: hourH).overlay(alignment: .top) { Rectangle().fill(.separator).frame(height: 0.5) } }
            }
            if let note { Text(note).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity).offset(y: hourH * 4) }
            GeometryReader { g in
                let lanes = Self.lanes(timed)
                ForEach(Array(timed.enumerated()), id: \.element.id) { i, e in
                    let a = max(Self.minutes(e.time!), startH * 60)
                    let b = min(max(e.end.map(Self.minutes) ?? a + 60, a + 30), endH * 60)
                    let n = CGFloat(lanes.count), w = g.size.width / max(n, 1)
                    block(e, tasks: inside.filter { sameSubject($0.subject, e.subject) && e.isClass })
                        .frame(width: w - 3, height: CGFloat(b - a) / 60 * hourH - 2)
                        .offset(x: CGFloat(lanes.index[i]) * w, y: CGFloat(a - startH * 60) / 60 * hourH + 1)
                }
                if day == today {
                    let c = cal.dateComponents([.hour, .minute], from: Date()), now = c.hour! * 60 + c.minute!
                    if now > startH * 60 && now < endH * 60 {
                        Rectangle().fill(.red).frame(height: 2).offset(y: CGFloat(now - startH * 60) / 60 * hourH)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: hourH * CGFloat(endH - startH))
        .background(note != nil ? Color.secondary.opacity(0.07) : day == selected ? Color.red.opacity(0.05) : .clear, in: RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { adding = day }
        .onTapGesture { selected = day }
    }

    static func lanes(_ list: [AgendaEvent]) -> (count: Int, index: [Int]) {
        var ends: [Int] = [], idx: [Int] = []
        for e in list {
            let a = minutes(e.time ?? "0"), b = e.end.map(minutes) ?? a + 60
            if let l = ends.firstIndex(where: { $0 <= a }) { ends[l] = b; idx.append(l) } else { ends.append(b); idx.append(ends.count - 1) }
        }
        return (ends.count, idx)
    }

    func block(_ e: AgendaEvent, tasks: [AgendaEvent] = []) -> some View {
        let done = model.isDone(e)
        return VStack(alignment: .leading, spacing: 2) {
            Text(model.revTitle(e)).font(.caption.weight(.semibold)).strikethrough(done)
            Text((e.timeLabel ?? "") + (e.isClass ? "" : " · " + Kind.label(e.kind))).font(.caption2).foregroundStyle(.secondary)
            ForEach(tasks) { t in
                Label(t.title + ((t.attachments ?? []).isEmpty ? "" : " 📎"), systemImage: Kind.icon(t.kind))
                    .font(.caption2.weight(.semibold)).lineLimit(1)
                    .strikethrough(model.isDone(t))
                    .padding(.horizontal, 5).padding(.vertical, 3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.background, in: RoundedRectangle(cornerRadius: 5))
                    .onTapGesture { detail = t }
            }
            if e.revision == true && !model.hasLevels { Text("✨ Clique pour personnaliser").font(.caption2.weight(.semibold)) }
            ForEach(model.revisionFor(e), id: \.self) { p in
                Text((model.isSujetSlot(e) ? "✏️ " : "📖 ") + p.label).font(.caption2.weight(.semibold)).lineLimit(1)
                    .padding(.horizontal, 5).padding(.vertical, 3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.background, in: RoundedRectangle(cornerRadius: 5))
            }
        }
        .padding(5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(eventColor(e.color).opacity(done ? 0.1 : e.isClass ? 0.3 : 0.22), in: RoundedRectangle(cornerRadius: 7))
        .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(eventColor(e.color)).frame(width: 3) }
        .clipped()
        .onTapGesture { detail = e }
    }
}

/// Cahier de texte : devoirs et évaluations à rendre, groupés par date.
struct CahierView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        let today = iso(Date())
        let weekAgo = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-7 * 86400))
        let work = model.events.filter(\.isDeadline)
        let todo = work.filter { $0.date >= today && !model.isDone($0) }.sorted { $0.sortKey < $1.sortKey }
        let late = work.filter { $0.date < today && !model.isDone($0) && daysBetween($0.date, today) <= 30 }
        let fresh = work.filter { $0.date >= today && ($0.createdAt ?? "") >= weekAgo }.count
        let dates = Array(Set(todo.map(\.date))).sorted()
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Cahier de texte").font(.largeTitle.bold())
                Text(todo.isEmpty ? "Tout est fait 🎉" : "\(todo.count) \(todo.count > 1 ? "travaux" : "travail") à faire" + (fresh > 0 ? " · \(fresh) nouveau\(fresh > 1 ? "x" : "") cette semaine" : "")).foregroundStyle(.secondary)
                if !late.isEmpty { group("En retard", late, today: today, weekAgo: weekAgo) }
                ForEach(dates, id: \.self) { d in
                    let n = daysBetween(today, d)
                    group(n == 0 ? "Pour aujourd'hui" : n == 1 ? "Pour demain" : "Pour \(longDate(d))", todo.filter { $0.date == d }, today: today, weekAgo: weekAgo)
                }
            }
            .padding(28)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }

    func group(_ title: String, _ list: [AgendaEvent], today: String, weekAgo: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(list) { e in
                EventRow(event: e, showDate: e.date < today)
                    .overlay(alignment: .topTrailing) {
                        if (e.createdAt ?? "") >= weekAgo { Text("Nouveau").font(.caption2.bold()).foregroundStyle(.blue).padding(.top, 6).padding(.trailing, 46) }
                    }
            }
        }
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
            if let t = event.timeLabel { Text(t).font(.caption2.bold()) }
            Text(event.title).font(.caption.weight(.semibold)).strikethrough(done)
            Text(Kind.label(event.kind)).font(.caption2).foregroundStyle(.secondary)
        }
        .padding(6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(eventColor(event.color).opacity(done ? 0.08 : 0.2), in: RoundedRectangle(cornerRadius: 6))
        .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(eventColor(event.color)).frame(width: 3) }
        .onTapGesture { detail = true }
        .sheet(isPresented: $detail) { if event.isClass { ClassDetail(event: event) } else { EventDetail(event: model.events.first { $0.id == event.id } ?? event) } }
    }
}

/// Cours fixe de l'emploi du temps.
struct ClassDetail: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let event: AgendaEvent
    @State private var levels = false
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label(event.revision == true ? "Révision · créneau conseillé" : "Cours · emploi du temps", systemImage: event.revision == true ? "brain.head.profile" : "graduationcap").foregroundStyle(eventColor(event.color))
                Spacer()
                Button("Fermer") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text(model.revTitle(event)).font(.title.bold())
            Label("\(longDate(event.date).capitalized) · \(event.timeLabel ?? "")", systemImage: "clock").foregroundStyle(.secondary)
            if let s = event.subject { Label(s, systemImage: "book.closed").foregroundStyle(.secondary) }
            if event.revision == true {
                if model.hasLevels {
                    Text("Au programme de ce créneau").font(.headline)
                    Text("Ta méthode : \(model.revMode == "sujets" ? "révision le matin, sujets le soir" : "révision seule")\(model.revMode == model.advisedMode ? " (conseillée pour toi)" : "")").font(.caption).foregroundStyle(.secondary)
                    RevisionContent(event: event)
                    Button("Modifier mon niveau par matière") { levels = true }
                } else {
                    Button("Personnaliser mes révisions (1 min)") { levels = true }.buttonStyle(.borderedProminent)
                }
                Text("Le matin pour la mémorisation, des séances de 1 h 30 à 2 h 30 avec pauses, et une reprise des cours de jeudi et vendredi dans les 48 h.").font(.caption).foregroundStyle(.secondary)
            }
            let chs = model.chapters.filter { $0.subject == event.subject }
            if !chs.isEmpty {
                Text("Cours de la matière").font(.headline)
                ScrollView { VStack(alignment: .leading, spacing: 10) { ForEach(chs) { ChapterFiles(chapter: $0) } } }
            }
            Spacer(minLength: 0)
            HStack {
                Text("Revient chaque semaine.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Réviser avec Objectif DCG") { ReviseWindow.show() }.buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
        .frame(width: 500, height: 520)
        .sheet(isPresented: $levels) { LevelsSurvey() }
    }
}

struct RevisionContent: View {
    @EnvironmentObject var model: AppModel
    let event: AgendaEvent
    @State private var askCorr: PdfFile?
    func open(_ f: PdfFile) { Task { do { PdfWindow.show(url: try await model.download(f), title: f.name) } catch { model.show(error.localizedDescription) } } }
    func pickRow(_ p: AppModel.RevisionPick) -> some View {
        VStack(alignment: .leading, spacing: 2) { Text(p.label).font(.body.weight(.semibold)); Text(p.why).font(.caption).foregroundStyle(.secondary) }
    }
    var body: some View {
        let picks = model.revisionFor(event)
        VStack(alignment: .leading, spacing: 8) {
            if picks.isEmpty { Text("Rien de prioritaire : reprends librement un chapitre.").foregroundStyle(.secondary) }
            else if !model.isSujetSlot(event) {
                Text("Relis le cours, fais-toi une fiche et récite sans regarder." + (model.revMode == "sujets" ? " En fin d'après-midi, tu feras les sujets de ces chapitres." : "")).font(.callout)
                ForEach(picks, id: \.self) { p in
                    HStack { pickRow(p); Spacer(); if let f = p.chapter?.file("cours") { Button("Fiche de cours") { open(f) }; Button { Task { do { try Reader.shared.read(url: try await model.download(f), title: p.chapter?.title ?? "Cours") } catch { model.show(error.localizedDescription) } } } label: { Label("Écouter", systemImage: "headphones") } } }
                }
            } else {
                Text("Les sujets des chapitres révisés ce matin. Fais-les sans regarder la correction.").font(.callout)
                let with = picks.filter { $0.chapter?.file("sujet") != nil }, without = picks.filter { $0.chapter?.file("sujet") == nil }
                ForEach(with, id: \.self) { p in
                    HStack {
                        Text(p.label).font(.body.weight(.semibold)); Spacer()
                        Button("Sujet") { open(p.chapter!.file("sujet")!) }.buttonStyle(.borderedProminent)
                        if let c = p.chapter?.file("corrige") { Button("Voir la correction") { askCorr = c } }
                    }
                }
                if !without.isEmpty {
                    Text((with.isEmpty ? "Pas de sujet en ligne pour ces chapitres." : "Pas de sujet pour l'autre chapitre.") + " Sinon voici des chapitres à réviser :").font(.callout.weight(.medium)).padding(.top, 6)
                    ForEach(without, id: \.self) { pickRow($0) }
                }
            }
        }
        .alert("Tu es sûr de vouloir voir la correction ?", isPresented: Binding(get: { askCorr != nil }, set: { if !$0 { askCorr = nil } })) {
            Button("Voir la correction") { if let c = askCorr { open(c) }; askCorr = nil }
            Button("Pas encore", role: .cancel) { askCorr = nil }
        } message: { Text("Essaie d'abord de finir le sujet seul.") }
    }
}

/// Mini-sondage : niveau de 1 à 10 dans chaque matière (privé).
struct LevelsSurvey: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    @State private var values: [String: Double] = [:]
    @State private var mode = 2
    var avg: Double { let v = model.revSubjects.map { values[$0] ?? 5 }; return v.isEmpty ? 5 : v.reduce(0, +) / Double(v.count) }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Mon niveau").font(.title2.bold())
            Picker("Méthode le week-end", selection: $mode) {
                Text("Révision le matin, sujets en fin d'après-midi").tag(2)
                Text("Révision seule").tag(1)
            }.pickerStyle(.radioGroup)
            Text(avg < 5 ? "Conseil pour toi : la révision seule, le temps de consolider tes bases (moyenne de tes niveaux sous 5/10)." : "Conseil pour toi : révision le matin et sujets le soir, pour t'entraîner comme le jour de l'éval.").font(.caption).foregroundStyle(.secondary)
            Text("Note de 1 à 10 ton niveau dans chaque matière. Les créneaux de révision du week-end te proposeront plus souvent tes matières faibles, en plus des chapitres de tes prochaines évals. Personne d'autre ne voit tes réponses.").foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            ForEach(model.revSubjects, id: \.self) { s in
                let v = Int(values[s] ?? 5)
                VStack(alignment: .leading) {
                    HStack { Text(s).font(.headline); Spacer(); Text("\(v)/10 · \(AppModel.levelWord(v))").foregroundStyle(.secondary) }
                    Slider(value: Binding(get: { values[s] ?? 5 }, set: { values[s] = $0.rounded() }), in: 1...10, step: 1).tint(.red)
                }
            }
            Spacer(minLength: 0)
            HStack {
                Spacer()
                Button("Annuler") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Enregistrer") {
                    var out = Dictionary(uniqueKeysWithValues: model.revSubjects.map { ($0, Int(values[$0] ?? 5)) })
                    out["__mode"] = mode
                    Task { if await model.saveLevels(out) { model.show("Révisions personnalisées ✓"); dismiss() } }
                }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
        .frame(width: 480)
        .onAppear { for s in model.revSubjects { values[s] = Double(model.levelOf(s) ?? 5) }; mode = model.profile?.levels?["__mode"] ?? (model.advisedMode == "sujets" ? 2 : 1) }
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
            if let c = model.classFor(event.date, event.subject) {
                Label("Pendant le cours de \(c.title) · \(c.timeLabel ?? "")", systemImage: "graduationcap").foregroundStyle(eventColor(c.color))
            }
            AttachmentList(event: event)
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

    init(event: AgendaEvent?, date: String, kind: String = "eval") {
        isNew = event == nil
        let e = event ?? AgendaEvent(id: "", kind: kind, title: "", subject: "", date: date, time: "", color: "blue", notes: "", chapters: [])
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
                Picker("Matière", selection: Binding(get: { ev.subject ?? "" }, set: {
                    ev.subject = $0; ev.chapters = []
                    if model.classFor(ev.date, $0) == nil, Kind.deadline.contains(ev.kind), let n = model.nextClasses($0).first { ev.date = n.date }
                    autoSlot()
                })) {
                    Text("Aucune").tag("")
                    ForEach(subjects, id: \.self) { Text($0).tag($0) }
                }
                DatePicker("Date", selection: Binding(get: { parseISO(ev.date) }, set: { ev.date = iso($0); autoSlot() }), displayedComponents: .date)
                if let c = model.classFor(ev.date, ev.subject) {
                    Label("Rangé dans le cours de \(c.title) · \(c.timeLabel ?? "")", systemImage: "graduationcap").foregroundStyle(eventColor(c.color))
                }
                let next = model.nextClasses(ev.subject).filter { $0.date != ev.date }.prefix(3)
                if !next.isEmpty {
                    HStack {
                        Text("Prochains cours :").foregroundStyle(.secondary)
                        ForEach(Array(next)) { c in Button(relativeDay(c.date)) { ev.date = c.date; autoSlot() }.buttonStyle(.link) }
                    }
                }
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

    /// Range le devoir dans le créneau du cours de la matière (heure et couleur du cours).
    func autoSlot() {
        guard let c = model.classFor(ev.date, ev.subject), let start = c.time else { return }
        let t = hasTime ? String(format: "%02d:%02d", cal.component(.hour, from: time), cal.component(.minute, from: time)) : ""
        if !hasTime || t < start || t >= (c.end ?? "") {
            let p = start.split(separator: ":").compactMap { Int($0) }
            time = cal.date(bySettingHour: p[0], minute: p[1], second: 0, of: Date())!
            hasTime = true
        }
        ev.color = c.color
    }

    var subjects: [String] {
        var s = model.courseSubjects
        if let cur = ev.subject, !cur.isEmpty, !s.contains(cur) { s.append(cur) }
        return s
    }
}


/// Sujet et fichiers joints à un devoir.
struct AttachmentList: View {
    @EnvironmentObject var model: AppModel
    let event: AgendaEvent
    @State private var importing = false
    @State private var busy = false
    var body: some View {
        let files = model.events.first { $0.id == event.id }?.attachments ?? event.attachments ?? []
        VStack(alignment: .leading, spacing: 6) {
            Text("Sujet et fichiers").font(.headline)
            ForEach(files, id: \.key) { f in
                HStack {
                    Image(systemName: "doc.richtext").foregroundStyle(.red)
                    Text(f.name).lineLimit(1)
                    Spacer()
                    Button("Ouvrir") { Task { do { PdfWindow.show(url: try await model.download(f), title: f.name) } catch { model.show(error.localizedDescription) } } }
                }
            }
            HStack {
                Button { importing = true } label: { Label("Ajouter une photo ou un PDF", systemImage: "paperclip") }
                if busy { ProgressView().controlSize(.small) }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .image], allowsMultipleSelection: true) { r in
            guard case .success(let urls) = r, !urls.isEmpty else { return }
            Task {
                busy = true
                let scoped = urls.map { $0.startAccessingSecurityScopedResource() }
                await model.attach(urls: urls, to: event)
                for (u, s) in zip(urls, scoped) where s { u.stopAccessingSecurityScopedResource() }
                busy = false
            }
        }
    }
}
