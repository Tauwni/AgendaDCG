import SwiftUI
import PDFKit
import UniformTypeIdentifiers

struct CoursView: View {
    @EnvironmentObject var model: AppModel
    @State private var subject: String?
    @State private var newChapter = false

    var body: some View {
        HSplitView {
            List(selection: $subject) {
                ForEach(SUBJECTS + model.courseSubjects.filter { !SUBJECTS.contains($0) }, id: \.self) { s in
                    let n = model.chapters.filter { $0.subject == s }.count
                    HStack {
                        Text(s)
                        Spacer()
                        if n > 0 { Text("\(n)").foregroundStyle(.secondary) }
                    }
                    .foregroundStyle(n > 0 ? .primary : .secondary)
                    .tag(s)
                }
            }
            .frame(minWidth: 240, idealWidth: 280, maxWidth: 360)

            Group {
                if let subject {
                    let list = model.chapters.filter { $0.subject == subject }
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            Text(subject).font(.title.bold())
                            if list.isEmpty { Text("Aucun chapitre pour l'instant.").foregroundStyle(.secondary) }
                            ForEach(list) { ch in ChapterCard(chapter: ch) }
                        }
                        .padding(24)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                } else {
                    ContentUnavailableView("Choisis une matière", systemImage: "books.vertical", description: Text("Fiches de cours, sujets, corrigés et TOP EXO."))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear { if subject == nil { subject = model.courseSubjects.first } }
    }
}

struct ChapterCard: View {
    @EnvironmentObject var model: AppModel
    let chapter: Chapter
    @State private var editing = false
    @State private var confirm = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(chapter.title).font(.headline)
            ChapterFiles(chapter: chapter, showTitle: false)
        }
        .padding(14)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
        .sheet(isPresented: $editing) { ChapterEditor(chapter: chapter, subject: chapter.subject) }
        .confirmationDialog("Supprimer « \(chapter.title) » et ses PDF pour toute la classe ?", isPresented: $confirm) {
            Button("Supprimer", role: .destructive) { Task { await model.deleteChapter(chapter) } }
        }
    }
}

struct ChapterFiles: View {
    @EnvironmentObject var model: AppModel
    let chapter: Chapter
    var editable = false
    var showTitle = true
    @State private var importing: String?
    @State private var busy: String?
    @State private var targeted: String?

    var body: some View {
        let current = model.chapter(chapter.id) ?? chapter
        VStack(alignment: .leading, spacing: 6) {
            if showTitle { Text(current.title).font(.subheadline.weight(.semibold)) }
            ForEach(SLOTS, id: \.id) { slot in
                let f = current.file(slot.id)
                if f != nil || editable {
                    HStack(spacing: 10) {
                        Image(systemName: f == nil ? "doc.badge.plus" : "doc.richtext").foregroundStyle(f == nil ? Color.secondary : Color.red).frame(width: 20)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(slot.label).font(.callout.weight(.medium))
                            Text(f.map { "\($0.name)\($0.size.map { " · " + fileSize($0) } ?? "")" } ?? "Glisse un PDF ou une photo ici")
                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer()
                        if busy == slot.id { ProgressView().controlSize(.small) }
                        if let f {
                            Button("Ouvrir") { open(f) }
                            if editable {
                                Menu {
                                    Button("Remplacer…") { importing = slot.id }
                                    Button("Supprimer", role: .destructive) { Task { await model.deleteFile(f, chapter: current, slot: slot.id) } }
                                } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).fixedSize()
                            }
                        } else if editable {
                            Button("Ajouter…") { importing = slot.id }
                        }
                    }
                    .padding(8)
                    .background(targeted == slot.id ? Color.accentColor.opacity(0.15) : Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
                    .onDrop(of: [.fileURL], isTargeted: Binding(get: { targeted == slot.id }, set: { targeted = $0 ? slot.id : nil })) { providers in
                        guard editable else { return false }
                        Task {
                            var urls: [URL] = []
                            for p in providers {
                                if let u = try? await p.loadItem(forTypeIdentifier: UTType.fileURL.identifier) as? Data, let url = URL(dataRepresentation: u, relativeTo: nil) { urls.append(url) }
                            }
                            await upload(urls, slot: slot.id, chapter: current)
                        }
                        return true
                    }
                }
            }
        }
        .fileImporter(isPresented: Binding(get: { importing != nil }, set: { if !$0 { importing = nil } }),
                      allowedContentTypes: [.pdf, .image], allowsMultipleSelection: true) { result in
            guard let slot = importing, case .success(let urls) = result else { return }
            Task { await upload(urls, slot: slot, chapter: current) }
        }
    }

    func upload(_ urls: [URL], slot: String, chapter: Chapter) async {
        busy = slot
        let scoped = urls.map { $0.startAccessingSecurityScopedResource() }
        await model.upload(urls: urls, chapter: chapter, slot: slot)
        for (u, s) in zip(urls, scoped) where s { u.stopAccessingSecurityScopedResource() }
        busy = nil
    }

    func open(_ f: PdfFile) {
        Task {
            do { PdfWindow.show(url: try await model.download(f), title: f.name) }
            catch { model.show(error.localizedDescription) }
        }
    }
}

struct ChapterEditor: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let chapter: Chapter?
    @State var subject: String
    @State private var title: String

    init(chapter: Chapter?, subject: String) {
        self.chapter = chapter
        _subject = State(initialValue: subject)
        _title = State(initialValue: chapter?.title ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(chapter == nil ? "Nouveau chapitre" : "Renommer le chapitre").font(.title2.bold())
            Picker("Matière", selection: $subject) { ForEach(SUBJECTS, id: \.self) { Text($0).tag($0) } }
            TextField("Ex. Chapitre 4 – L'affectation du résultat", text: $title).textFieldStyle(.roundedBorder)
            HStack {
                Button("Annuler") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button(chapter == nil ? "Créer" : "Enregistrer") {
                    Task { if await model.saveChapter(id: chapter?.id, subject: subject, title: title) != nil { dismiss() } }
                }
                .keyboardShortcut(.defaultAction).disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(24).frame(width: 460)
    }
}

/// Lecteur PDF natif (PDFKit) dans sa propre fenêtre.
enum PdfWindow {
    @MainActor static var windows: [NSWindow] = []
    @MainActor static func show(url: URL, title: String) {
        let view = PDFView()
        view.document = PDFDocument(url: url)
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 820, height: 1000), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        win.title = title
        win.representedURL = url
        win.contentView = view
        win.isReleasedWhenClosed = false
        win.center()
        win.makeKeyAndOrderFront(nil)
        windows.append(win)
        windows.removeAll { !$0.isVisible && $0 !== win }
    }
}
