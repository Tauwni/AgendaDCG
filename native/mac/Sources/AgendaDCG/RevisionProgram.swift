import SwiftUI

extension AppModel {
    /// Prochains créneaux de révision (aujourd'hui compris, pas encore terminés), sur 8 jours.
    func nextRevisionSlots(_ max: Int = 4) -> [AgendaEvent] {
        let now = Date()
        let hm = String(format: "%02d:%02d", cal.component(.hour, from: now), cal.component(.minute, from: now))
        var out: [AgendaEvent] = []
        for i in 0..<8 {
            for c in schedule?.classes(on: iso(addDays(now, i))) ?? [] where c.revision == true && (i > 0 || (c.end ?? "24:00") > hm) && out.count < max { out.append(c) }
        }
        return out
    }
}

/// Carte d'un créneau de révision : titre, horaire, chapitres proposés. Un clic ouvre le détail.
struct RevisionSlotCard: View {
    @EnvironmentObject var model: AppModel
    let slot: AgendaEvent
    var listen = false
    @State private var detail = false

    var body: some View {
        let picks = model.revisionFor(slot)
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 2).fill(.green).frame(width: 4)
            VStack(alignment: .leading, spacing: 3) {
                Text(model.revTitle(slot)).font(.headline)
                Text("\(slot.date == iso(Date()) ? "Aujourd'hui" : longDate(slot.date).capitalized) · \(slot.timeLabel ?? "")").font(.caption).foregroundStyle(.secondary)
                if !model.hasLevels { Text("✨ Clique pour personnaliser tes révisions").font(.callout).foregroundStyle(.secondary) }
                ForEach(Array(picks.enumerated()), id: \.offset) { _, p in
                    Text("\(model.isSujetSlot(slot) ? "✏️" : "📖") \(p.label)").font(.callout).lineLimit(1)
                }
            }
            Spacer()
            if listen, !model.isSujetSlot(slot), let p = picks.first(where: { $0.chapter?.file("cours") != nil }), let f = p.chapter?.file("cours") {
                Button { Task { do { try Reader.shared.read(url: try await model.download(f), title: p.label, key: f.key) } catch { model.show(error.localizedDescription) } } } label: { Label("Écouter", systemImage: "headphones") }
            }
            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
        }
        .padding(12)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
        .contentShape(Rectangle())
        .onTapGesture { detail = true }
        .sheet(isPresented: $detail) { ClassDetail(event: slot) }
    }
}

/// Programme de révision : méthode choisie + prochains créneaux.
struct RevisionProgram: View {
    @EnvironmentObject var model: AppModel
    @State private var levels = false
    var body: some View {
        let slots = model.nextRevisionSlots(4)
        if !slots.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Mon programme de révision").font(.title2.bold())
                if model.hasLevels {
                    Text("Ma méthode : \(model.revMode == "sujets" ? "révision le matin, sujets le soir" : "révision seule")\(model.revMode == model.advisedMode ? " (conseillée pour toi)" : "").").foregroundStyle(.secondary)
                }
                ForEach(slots) { RevisionSlotCard(slot: $0) }
                Button(model.hasLevels ? "Modifier ma méthode et mon niveau" : "Personnaliser mes révisions (1 min)") { levels = true }
            }
            .sheet(isPresented: $levels) { LevelsSurvey() }
        }
    }
}
