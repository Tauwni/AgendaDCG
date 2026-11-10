using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using Microsoft.Win32;
using static AgendaDCG.Ui;

namespace AgendaDCG;

public static class Dialogs
{
    static Store S => Store.I;

    public static void EventDetail(AgendaEvent e)
    {
        Window? w = null;
        var body = new StackPanel();
        body.Children.Add(H(8, Icon(Data.KindGlyph(e.Kind), 15, Theme.Of(e.Color)), T(Data.KindLabel(e.Kind), 14, FontWeights.SemiBold, Theme.Of(e.Color))));
        var title = new TextBlock { Text = e.Title, FontSize = 24, FontWeight = FontWeights.Bold, Foreground = Theme.Text, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 8) };
        body.Children.Add(title);
        body.Children.Add(T(Data.Cap(Data.LongDate(e.Date)) + (string.IsNullOrEmpty(e.Time) ? "" : $" à {e.Time}"), 14, null, Theme.Text2));
        if (!string.IsNullOrEmpty(e.Subject)) body.Children.Add(T(e.Subject, 14, null, Theme.Text2));
        if (S.ClassFor(e.Date, e.Subject) is { } cls) { var cl = T($"Pendant le cours de {cls.Title} · {cls.TimeLabel}", 13, FontWeights.SemiBold, Theme.Of(cls.Color)); cl.Margin = new Thickness(0, 6, 0, 0); body.Children.Add(cl); }
        var att = T("Sujet et fichiers", 16, FontWeights.Bold); att.Margin = new Thickness(0, 16, 0, 6); body.Children.Add(att);
        foreach (var f in e.Attachments ?? new())
        {
            var ff = f;
            var b = Btn("📄 " + f.Name, async () => await Try(async () => { var p = await S.Download(ff); Process.Start(new ProcessStartInfo(p) { UseShellExecute = true }); }));
            b.HorizontalAlignment = HorizontalAlignment.Left; b.Margin = new Thickness(0, 0, 0, 4); body.Children.Add(b);
        }
        var add = Btn("+ Joindre un PDF (sujet, consignes…)", async () =>
        {
            var dlg = new OpenFileDialog { Filter = "PDF (*.pdf)|*.pdf", Title = "Joindre un PDF" };
            if (dlg.ShowDialog() != true) return;
            Toast("Envoi…");
            if (await Try(() => S.Attach(dlg.FileName, e))) { Toast("Fichier ajouté"); w!.Close(); EventDetail(S.Events.First(x => x.Id == e.Id)); }
        });
        add.HorizontalAlignment = HorizontalAlignment.Left; body.Children.Add(add);
        if (!string.IsNullOrEmpty(e.Notes)) body.Children.Add(new TextBox { Text = e.Notes, IsReadOnly = true, TextWrapping = TextWrapping.Wrap, BorderThickness = new Thickness(0), Background = Brushes.Transparent, Foreground = Theme.Text, FontSize = 14, Margin = new Thickness(0, 12, 0, 0) });
        var chs = (e.Chapters ?? new()).Select(S.Chapter).Where(c => c != null).ToList();
        if (chs.Count > 0)
        {
            var h = T("Chapitres", 16, FontWeights.Bold); h.Margin = new Thickness(0, 16, 0, 6); body.Children.Add(h);
            foreach (var ch in chs) { var f = ChapterFiles(ch!, false); f.Margin = new Thickness(0, 0, 0, 10); body.Children.Add(f); }
        }
        if (e.IsDeadline)
        {
            var done = S.IsDone(e);
            var b = Btn(done ? "✓ Fait" : "Marquer comme fait", async () => { await Try(() => S.ToggleDone(e)); w!.Close(); }, primary: !done);
            b.HorizontalAlignment = HorizontalAlignment.Left; b.Margin = new Thickness(0, 14, 0, 0);
            body.Children.Add(b);
        }
        if (e.UpdatedBy != null) { var m = T($"Modifié par {e.UpdatedBy}", 12, null, Theme.Text2); m.Margin = new Thickness(0, 12, 0, 0); body.Children.Add(m); }
        var actions = new DockPanel { Margin = new Thickness(0, 20, 0, 0) };
        var edit = Btn("Modifier", () => { w!.Close(); EventEditor(e, e.Date); }, primary: true);
        DockPanel.SetDock(edit, Dock.Right); actions.Children.Add(edit);
        var del = Btn("Supprimer", async () => { if (Confirm($"Supprimer « {e.Title} » pour toute la classe ?") && await Try(() => S.Delete(e))) { w!.Close(); Toast("Supprimé"); } }, danger: true);
        del.HorizontalAlignment = HorizontalAlignment.Left; actions.Children.Add(del);
        body.Children.Add(actions);
        w = Dialog(e.Title, body, 500);
        w.ShowDialog();
    }

    public static void ClassDetail(AgendaEvent e)
    {
        Window? w = null;
        var body = new StackPanel();
        body.Children.Add(H(8, Icon(Data.KindGlyph("cours"), 15, Theme.Of(e.Color)), T(e.Revision ? "Révision · créneau conseillé" : "Cours · emploi du temps", 14, FontWeights.SemiBold, Theme.Of(e.Color))));
        var title = T(S.RevTitle(e), 24, FontWeights.Bold); title.Margin = new Thickness(0, 8, 0, 8); body.Children.Add(title);
        body.Children.Add(T($"{Data.Cap(Data.LongDate(e.Date))} · {e.TimeLabel}", 14, null, Theme.Text2));
        body.Children.Add(T(e.Subject ?? "", 14, null, Theme.Text2));
        if (e.Revision)
        {
            if (S.HasLevels)
            {
                var h = T("Au programme de ce créneau", 16, FontWeights.Bold); h.Margin = new Thickness(0, 16, 0, 6); body.Children.Add(h);
                var mode = T($"Ta méthode : {(S.RevMode == "sujets" ? "révision le matin, sujets le soir" : "révision seule")}{(S.RevMode == S.AdvisedMode ? " (conseillée pour toi)" : "")}", 12, null, Theme.Text2); mode.Margin = new Thickness(0, 0, 0, 8); body.Children.Add(mode);
                var picks = S.RevisionFor(e);
                void Open(PdfFile f) => _ = Try(async () => { var p = await S.Download(f); Process.Start(new ProcessStartInfo(p) { UseShellExecute = true }); });
                UIElement Row(Store.RevisionPick p) { var r = V(1, T(p.Label, 14, FontWeights.SemiBold), T(p.Why, 12, null, Theme.Text2)); r.Margin = new Thickness(0, 0, 0, 8); return r; }
                TextBlock Para(string s) { var x = T(s, 13); x.TextWrapping = TextWrapping.Wrap; x.Margin = new Thickness(0, 0, 0, 8); return x; }
                if (picks.Count == 0) body.Children.Add(T("Rien de prioritaire : reprends librement un chapitre.", 13, null, Theme.Text2));
                else if (!S.IsSujetSlot(e))
                {
                    body.Children.Add(Para("Relis le cours, fais-toi une fiche et récite sans regarder." + (S.RevMode == "sujets" ? " En fin d'après-midi, tu feras les sujets de ces chapitres." : "")));
                    foreach (var p in picks)
                    {
                        body.Children.Add(Row(p));
                        if (p.Chapter?.Files.GetValueOrDefault("cours") is { } f) { var fb = Btn("Fiche de cours", () => Open(f)); fb.HorizontalAlignment = HorizontalAlignment.Left; fb.Margin = new Thickness(0, 0, 0, 10); body.Children.Add(fb); }
                    }
                }
                else
                {
                    body.Children.Add(Para("Les sujets des chapitres révisés ce matin. Fais-les sans regarder la correction."));
                    var with = picks.Where(p => p.Chapter?.Files.GetValueOrDefault("sujet") != null).ToList();
                    var without = picks.Where(p => p.Chapter?.Files.GetValueOrDefault("sujet") == null).ToList();
                    foreach (var p in with)
                    {
                        var sujet = p.Chapter!.Files["sujet"]!; var corr = p.Chapter.Files.GetValueOrDefault("corrige");
                        var row = H(8, T(p.Label, 14, FontWeights.SemiBold), Btn("Sujet", () => Open(sujet), primary: true));
                        if (corr != null) row.Children.Add(Btn("Voir la correction", () => { if (Confirm("Tu es sûr de vouloir voir la correction ? Essaie d'abord de finir le sujet seul.")) Open(corr); }));
                        row.Margin = new Thickness(0, 0, 0, 8); body.Children.Add(row);
                    }
                    if (without.Count > 0)
                    {
                        body.Children.Add(Para((with.Count == 0 ? "Pas de sujet en ligne pour ces chapitres." : "Pas de sujet pour l'autre chapitre.") + " Sinon voici des chapitres à réviser :"));
                        foreach (var p in without) body.Children.Add(Row(p));
                    }
                }
            }
            var lb = Btn(S.HasLevels ? "Modifier mon niveau par matière" : "Personnaliser mes révisions (1 min)", () => { w?.Close(); LevelsSurvey(); }, primary: !S.HasLevels);
            lb.HorizontalAlignment = HorizontalAlignment.Left; lb.Margin = new Thickness(0, 10, 0, 0); body.Children.Add(lb);
            var tip = T("Le matin pour la mémorisation, des séances de 1 h 30 à 2 h 30 avec pauses, et une reprise des cours de jeudi et vendredi dans les 48 h.", 12, null, Theme.Text2); tip.TextWrapping = TextWrapping.Wrap; tip.Margin = new Thickness(0, 10, 0, 0); body.Children.Add(tip);
        }
        var chs = S.Chapters.Where(c => c.Subject == e.Subject).ToList();
        if (chs.Count > 0)
        {
            var h = T("Cours de la matière", 16, FontWeights.Bold); h.Margin = new Thickness(0, 16, 0, 6); body.Children.Add(h);
            foreach (var ch in chs) { var f = ChapterFiles(ch, false); f.Margin = new Thickness(0, 0, 0, 10); body.Children.Add(f); }
        }
        var actions = new DockPanel { Margin = new Thickness(0, 18, 0, 0) };
        var rev = Btn("Réviser avec Objectif DCG", MainWindow.OpenRevise, primary: true); DockPanel.SetDock(rev, Dock.Right); actions.Children.Add(rev);
        var note = T("Revient chaque semaine.", 12, null, Theme.Text2); note.VerticalAlignment = VerticalAlignment.Center; actions.Children.Add(note);
        body.Children.Add(actions);
        w = Dialog(e.Title, body, 520);
        w.ShowDialog();
    }

    /// Mini-sondage : niveau de 1 à 10 dans chaque matière (privé).
    public static void LevelsSurvey()
    {
        Window? w = null;
        var body = new StackPanel();
        var intro = T("Note de 1 à 10 ton niveau dans chaque matière. Les créneaux de révision du week-end te proposeront plus souvent tes matières faibles, en plus des chapitres de tes prochaines évals. Personne d'autre ne voit tes réponses.", 13, null, Theme.Text2);
        intro.TextWrapping = TextWrapping.Wrap; intro.Margin = new Thickness(0, 0, 0, 12); body.Children.Add(intro);
        var curMode = S.Profile?.Levels?.GetValueOrDefault("__mode") is int m && m > 0 ? m : (S.AdvisedMode == "sujets" ? 2 : 1);
        var rbS = new RadioButton { Content = "Révision le matin, sujets en fin d'après-midi", IsChecked = curMode == 2, Foreground = Theme.Text, Margin = new Thickness(0, 0, 0, 4) };
        var rbR = new RadioButton { Content = "Révision seule", IsChecked = curMode == 1, Foreground = Theme.Text, Margin = new Thickness(0, 0, 0, 6) };
        body.Children.Add(T("Ma méthode le week-end", 14, FontWeights.SemiBold)); body.Children.Add(rbS); body.Children.Add(rbR);
        var advice = T("", 12, null, Theme.Text2); advice.TextWrapping = TextWrapping.Wrap; advice.Margin = new Thickness(0, 0, 0, 12); body.Children.Add(advice);
        var sliders = new Dictionary<string, Slider>();
        void Advise() { var avg = sliders.Count == 0 ? 5 : sliders.Values.Average(x => x.Value); advice.Text = avg < 5 ? "Conseil pour toi : la révision seule, le temps de consolider tes bases (moyenne de tes niveaux sous 5/10)." : "Conseil pour toi : révision le matin et sujets le soir, pour t'entraîner comme le jour de l'éval."; }
        foreach (var s in S.RevSubjects())
        {
            var v = S.LevelOf(s) ?? 5;
            var val = T($"{v}/10 · {Store.LevelWord(v)}", 13, null, Theme.Text2);
            var sl = new Slider { Minimum = 1, Maximum = 10, Value = v, IsSnapToTickEnabled = true, TickFrequency = 1, Margin = new Thickness(0, 4, 0, 12) };
            sl.ValueChanged += (_, _) => { val.Text = $"{(int)sl.Value}/10 · {Store.LevelWord((int)sl.Value)}"; Advise(); };
            var head = new DockPanel(); DockPanel.SetDock(val, Dock.Right); head.Children.Add(val); head.Children.Add(T(s, 14, FontWeights.SemiBold));
            body.Children.Add(head); body.Children.Add(sl); sliders[s] = sl;
        }
        Advise();
        var save = Btn("Enregistrer", async () =>
        {
            var levels = sliders.ToDictionary(kv => kv.Key, kv => (int)kv.Value.Value);
            levels["__mode"] = rbS.IsChecked == true ? 2 : 1;
            if (await Try(() => S.SaveLevels(levels))) { w!.Close(); Toast("Révisions personnalisées ✓"); }
        }, primary: true);
        save.HorizontalAlignment = HorizontalAlignment.Right; body.Children.Add(save);
        w = Dialog("Mon niveau", body, 480);
        w.ShowDialog();
    }

    public static void EventEditor(AgendaEvent? existing, string date, string defaultKind = "eval")
    {
        var isNew = existing == null;
        var ev = existing ?? new AgendaEvent { Date = date, Color = "blue", Chapters = new(), Kind = defaultKind };
        var chapters = new HashSet<string>(ev.Chapters ?? new());
        var color = ev.Color ?? "blue";
        Window? w = null;

        var kind = Combo(Data.Kinds.Select(k => (k.Id, k.Label)), ev.Kind);
        var title = Input(ev.Title);
        var subjects = S.CourseSubjects();
        if (!string.IsNullOrEmpty(ev.Subject) && !subjects.Contains(ev.Subject)) subjects.Add(ev.Subject);
        var subject = Combo(new[] { ("", "Aucune") }.Concat(subjects.Select(s => (s, s))), ev.Subject ?? "");
        var day = new DatePicker { SelectedDate = Data.Parse(ev.Date), FontSize = 14 };
        var time = Input(ev.Time ?? "", "HH:MM (laisser vide si pas d'heure)");
        var colors = new StackPanel { Orientation = Orientation.Horizontal };
        void DrawColors()
        {
            colors.Children.Clear();
            foreach (var c in Data.ColorNames)
            {
                var dot = new Border { Width = 24, Height = 24, CornerRadius = new CornerRadius(12), Background = Theme.Of(c), Margin = new Thickness(0, 0, 8, 0), BorderBrush = Theme.Text, BorderThickness = new Thickness(c == color ? 2.5 : 0), Cursor = System.Windows.Input.Cursors.Hand };
                var cc = c;
                dot.MouseLeftButtonUp += (_, _) => { color = cc; DrawColors(); };
                colors.Children.Add(dot);
            }
        }
        DrawColors();
        var chapterBox = new StackPanel();
        void DrawChapters()
        {
            chapterBox.Children.Clear();
            var list = S.Chapters.Where(c => c.Subject == subject.Value()).ToList();
            if (list.Count == 0) return;
            chapterBox.Children.Add(T("Chapitres concernés", 13, FontWeights.SemiBold, Theme.Text2));
            foreach (var ch in list)
            {
                var cb = new CheckBox { Content = T(ch.Title, 13), IsChecked = chapters.Contains(ch.Id), Margin = new Thickness(0, 4, 0, 0) };
                var id = ch.Id;
                cb.Click += (_, _) => { if (cb.IsChecked == true) chapters.Add(id); else chapters.Remove(id); };
                chapterBox.Children.Add(cb);
            }
        }
        var slotInfo = T("", 13, FontWeights.SemiBold, Theme.Text2);
        void AutoSlot()
        {
            var d = Data.Iso(day.SelectedDate ?? DateTime.Today);
            if (S.ClassFor(d, subject.Value()) is { } c)
            {
                var t = time.Text.Trim();
                if (t == "" || string.CompareOrdinal(t, c.Time) < 0 || string.CompareOrdinal(t, c.End) >= 0) time.Text = c.Time;
                color = c.Color ?? color; DrawColors();
                slotInfo.Text = $"Rangé dans le cours de {c.Title} · {c.TimeLabel}"; slotInfo.Foreground = Theme.Of(c.Color);
            }
            else slotInfo.Text = "";
        }
        subject.SelectionChanged += (_, _) =>
        {
            chapters.Clear(); DrawChapters();
            var d = Data.Iso(day.SelectedDate ?? DateTime.Today);
            if (S.ClassFor(d, subject.Value()) == null && Data.Deadline.Contains(kind.Value()) && S.NextClasses(subject.Value()).FirstOrDefault() is { } n) day.SelectedDate = Data.Parse(n.Date);
            AutoSlot();
        };
        day.SelectedDateChanged += (_, _) => AutoSlot();
        AutoSlot();
        DrawChapters();
        var notes = new TextBox { Text = ev.Notes ?? "", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, Height = 90, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var err = T("", 13, null, Theme.Accent);

        var save = Btn(isNew ? "Ajouter" : "Enregistrer", async () =>
        {
            var t = time.Text.Trim();
            if (t != "" && !System.Text.RegularExpressions.Regex.IsMatch(t, @"^\d{1,2}[:h]\d{2}$")) { err.Text = "Heure au format 14:30"; return; }
            if (t != "") { var p = t.Split(':', 'h'); t = $"{int.Parse(p[0]):00}:{p[1]}"; }
            var updated = new AgendaEvent
            {
                Id = ev.Id, Kind = kind.Value(), Title = title.Text.Trim(), Subject = subject.Value(), Date = Data.Iso(day.SelectedDate ?? DateTime.Today),
                Time = t, Color = color, Notes = notes.Text, Chapters = chapters.ToList(),
            };
            if (updated.Title == "") { err.Text = "Le titre est obligatoire"; return; }
            if (await Try(() => S.Save(updated, isNew))) { w!.Close(); Toast(isNew ? "Ajouté" : "Modifié"); }
        }, primary: true);
        save.IsDefault = true;
        var actions = new DockPanel { Margin = new Thickness(0, 16, 0, 0) };
        DockPanel.SetDock(save, Dock.Right); actions.Children.Add(save);
        var cancel = Btn("Annuler", () => w!.Close()); cancel.HorizontalAlignment = HorizontalAlignment.Left; actions.Children.Add(cancel);

        var body = V(4, T(isNew ? "Nouvel événement" : "Modifier", 22, FontWeights.Bold),
            Field("Type", kind), Field("Titre", title), Field("Matière", subject), Field("Date", day), Field("Heure", time),
            slotInfo, Field("Couleur", colors), chapterBox, T("Notes", 13, FontWeights.SemiBold, Theme.Text2), notes, err, actions);
        w = Dialog(isNew ? "Nouvel événement" : "Modifier", body, 520);
        title.Focus();
        w.ShowDialog();
    }

    public static void MonthPicker(DateTime current, Action<DateTime> pick)
    {
        Window? w = null;
        var year = current.Year;
        var grid = new UniformGrid { Columns = 3 };
        var label = T("", 18, FontWeights.Bold); label.HorizontalAlignment = HorizontalAlignment.Center;
        void Draw()
        {
            label.Text = year.ToString();
            grid.Children.Clear();
            for (var m = 1; m <= 12; m++)
            {
                var mm = m;
                var b = Btn(Data.Cap(new DateTime(year, m, 1).ToString("MMMM", Data.Fr)), () => { w!.Close(); pick(new DateTime(year, mm, 1)); }, primary: year == current.Year && m == current.Month);
                b.Margin = new Thickness(4);
                grid.Children.Add(b);
            }
        }
        Draw();
        var head = new DockPanel();
        var prev = IconBtn("", () => { year--; Draw(); }, "Année précédente"); DockPanel.SetDock(prev, Dock.Left);
        var next = IconBtn("", () => { year++; Draw(); }, "Année suivante"); DockPanel.SetDock(next, Dock.Right);
        head.Children.Add(prev); head.Children.Add(next); head.Children.Add(label);
        w = Dialog("Choisir un mois", V(10, head, grid), 380);
        w.ShowDialog();
    }

    public static FrameworkElement ChapterFiles(Chapter chapter, bool editable, bool showTitle = true)
    {
        var panel = new StackPanel();
        if (showTitle) panel.Children.Add(T(chapter.Title, 14, FontWeights.SemiBold));
        foreach (var (slot, label) in Data.Slots)
        {
            var f = chapter.File(slot);
            if (f == null && !editable) continue;
            var row = new DockPanel();
            var buttons = new StackPanel { Orientation = Orientation.Horizontal };
            if (f != null)
            {
                buttons.Children.Add(Btn("Ouvrir", async () => await Try(async () =>
                {
                    Toast("Ouverture…");
                    var path = await S.Download(f);
                    Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
                })));
                if (editable)
                {
                    buttons.Children.Add(IconBtn("", () => Pick(chapter, slot), "Remplacer"));
                    buttons.Children.Add(IconBtn("", async () => { if (Confirm($"Supprimer {label.ToLower()} ?")) await Try(() => S.DeleteFile(f, chapter, slot)); }, "Supprimer"));
                }
            }
            else buttons.Children.Add(Btn("Ajouter…", () => Pick(chapter, slot)));
            DockPanel.SetDock(buttons, Dock.Right);
            row.Children.Add(buttons);
            var ic = Icon(f == null ? "" : "", 16, f == null ? Theme.Text2 : Theme.Accent); ic.Margin = new Thickness(0, 0, 10, 0);
            DockPanel.SetDock(ic, Dock.Left); row.Children.Add(ic);
            row.Children.Add(V(1, T(label, 13, FontWeights.SemiBold), T(f == null ? "Glisse un PDF ici ou clique sur Ajouter" : f.Name + (f.Size is long s ? $" · {Data.Size(s)}" : ""), 12, null, Theme.Text2)));
            var b = new Border { Child = row, Padding = new Thickness(8), CornerRadius = new CornerRadius(8), Background = Theme.Of("blue", 12), Margin = new Thickness(0, 4, 0, 0), AllowDrop = editable };
            if (editable)
                b.Drop += async (_, e) =>
                {
                    if (e.Data.GetData(DataFormats.FileDrop) is string[] files && files.Length > 0) await Upload(files[0], chapter, slot);
                };
            panel.Children.Add(b);
        }
        return panel;
    }

    static async void Pick(Chapter chapter, string slot)
    {
        var dlg = new OpenFileDialog { Filter = "PDF (*.pdf)|*.pdf", Title = "Choisir un PDF" };
        if (dlg.ShowDialog() == true) await Upload(dlg.FileName, chapter, slot);
    }

    static async Task Upload(string path, Chapter chapter, string slot)
    {
        if (!path.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) { Toast("Seuls les PDF sont acceptés"); return; }
        Toast("Envoi du PDF…");
        if (await Try(() => S.Upload(path, chapter, slot))) Toast("PDF ajouté");
    }

    public static void ChapterEditor(Chapter? chapter, string subject)
    {
        Window? w = null;
        var sub = Combo(Data.Subjects.Select(s => (s, s)), subject);
        var title = Input(chapter?.Title ?? "", "Ex. Chapitre 4 – L'affectation du résultat");
        var save = Btn(chapter == null ? "Créer" : "Enregistrer", async () =>
        {
            if (title.Text.Trim() == "") return;
            if (await Try(() => S.SaveChapter(chapter?.Id, sub.Value(), title.Text.Trim()))) w!.Close();
        }, primary: true);
        save.IsDefault = true; save.HorizontalAlignment = HorizontalAlignment.Right;
        w = Dialog(chapter == null ? "Nouveau chapitre" : "Renommer", V(8, T(chapter == null ? "Nouveau chapitre" : "Renommer le chapitre", 22, FontWeights.Bold), Field("Matière", sub), Field("Nom", title), save), 520);
        title.Focus();
        w.ShowDialog();
    }

    public static void GradeEditor(Grade? existing, string? subject)
    {
        var isNew = existing == null;
        var g = existing ?? new Grade { Subject = subject ?? "", Date = Data.Iso(DateTime.Today) };
        Window? w = null;
        var sub = Combo(new[] { ("", "Choisir…") }.Concat(Data.Subjects.Select(s => (s, s))), g.Subject);
        var title = Input(g.Title);
        var cat = Combo(Data.Categories, g.Category);
        var day = new DatePicker { SelectedDate = Data.Parse(g.Date), FontSize = 14 };
        var value = Input(isNew ? "" : Data.Num(g.Value, 2));
        var outOf = Input(Data.Num(g.OutOf));
        var coef = Input(Data.Num(g.Coef));
        var err = T("", 13, null, Theme.Accent);
        var actions = new DockPanel { Margin = new Thickness(0, 14, 0, 0) };
        var save = Btn(isNew ? "Ajouter" : "Enregistrer", async () =>
        {
            var grade = new Grade
            {
                Id = isNew ? Guid.NewGuid().ToString() : g.Id, Subject = sub.Value(), Title = title.Text.Trim(), Category = cat.Value(),
                Date = Data.Iso(day.SelectedDate ?? DateTime.Today), Value = Number(value.Text) ?? -1, OutOf = Number(outOf.Text) ?? 20, Coef = Number(coef.Text) ?? 1,
            };
            if (grade.Subject == "") { err.Text = "Choisis une matière"; return; }
            var all = (S.Profile?.Grades ?? new()).Where(x => x.Id != grade.Id).Append(grade).ToList();
            if (await Try(() => S.SaveGrades(all))) w!.Close();
        }, primary: true);
        save.IsDefault = true;
        DockPanel.SetDock(save, Dock.Right); actions.Children.Add(save);
        if (!isNew)
        {
            var del = Btn("Supprimer", async () => { if (Confirm("Supprimer cette note ?") && await Try(() => S.SaveGrades((S.Profile?.Grades ?? new()).Where(x => x.Id != g.Id).ToList()))) w!.Close(); }, danger: true);
            del.HorizontalAlignment = HorizontalAlignment.Left; actions.Children.Add(del);
        }
        w = Dialog(isNew ? "Nouvelle note" : "Modifier la note", V(4, T(isNew ? "Nouvelle note" : "Modifier la note", 22, FontWeights.Bold),
            Field("Matière", sub), Field("Intitulé", title), Field("Type", cat), Field("Date", day), Field("Note", value), Field("Sur", outOf), Field("Coefficient", coef),
            T("Les entraînements ne comptent pas dans la moyenne.", 12, null, Theme.Text2), err, actions), 480);
        value.Focus();
        w.ShowDialog();
    }

    public static void SubjectDetail(string subject)
    {
        Window? w = null;
        var body = new StackPanel();
        void Draw()
        {
            body.Children.Clear();
            var gs = (S.Profile?.Grades ?? new()).Where(g => g.Subject == subject).OrderBy(g => g.Date).ToList();
            var counted = gs.Where(g => g.Category != "entrainement").ToList();
            double Sum = counted.Sum(g => g.On20 * g.Coef), C = counted.Sum(g => g.Coef);
            body.Children.Add(T(subject, 22, FontWeights.Bold));
            body.Children.Add(T("Moyenne : " + (Data.Average(gs) is { } a ? Data.Num(a, 2) : "–"), 16));
            var chart = MainWindow.Chart(gs, 500, 160); chart.Margin = new Thickness(0, 12, 0, 12);
            body.Children.Add(chart);
            var target = Input("12"); var coef = Input("1");
            var result = T("", 14, FontWeights.SemiBold);
            void Sim()
            {
                if (Number(target.Text) is not double t || Number(coef.Text) is not double c || c <= 0 || t < 0 || t > 20) { result.Text = "Entre une moyenne entre 0 et 20 et un coefficient positif."; return; }
                var need = (t * (C + c) - Sum) / c;
                result.Text = need > 20 ? $"Même avec 20/20, ta moyenne monterait à {Data.Num((Sum + 20 * c) / (C + c), 2)}."
                    : need <= 0 ? $"C'est déjà gagné : même avec 0/20 tu restes à {Data.Num(Sum / (C + c), 2)} ou plus."
                    : $"Il te faut au moins {Data.Num(need, 2)}/20 au prochain contrôle.";
            }
            target.TextChanged += (_, _) => Sim(); coef.TextChanged += (_, _) => Sim(); Sim();
            body.Children.Add(Card(V(4, T("Simulateur", 14, FontWeights.Bold), Field("Moyenne visée", target), Field("Coefficient", coef), result)));
            foreach (var g in Enumerable.Reverse(gs))
            {
                var row = new DockPanel();
                var v = T($"{Data.Num(g.Value, 2)}/{Data.Num(g.OutOf)}", 15, FontWeights.Bold); DockPanel.SetDock(v, Dock.Right); row.Children.Add(v);
                var catLabel = Data.Categories.First(c => c.Id == g.Category).Label;
                row.Children.Add(V(1, T(g.Title == "" ? catLabel : g.Title, 14, FontWeights.SemiBold), T($"{catLabel} · {Data.LongDate(g.Date)}{(g.Coef != 1 ? $" · coef {Data.Num(g.Coef)}" : "")}", 12, null, Theme.Text2)));
                var item = Clickable(row, () => { GradeEditor(g, subject); Draw(); });
                item.Margin = new Thickness(0, 10, 0, 0);
                body.Children.Add(item);
            }
            var add = Btn("+ Ajouter une note", () => { GradeEditor(null, subject); Draw(); }, primary: true);
            add.HorizontalAlignment = HorizontalAlignment.Right; add.Margin = new Thickness(0, 16, 0, 0);
            body.Children.Add(add);
        }
        Draw();
        w = Dialog(subject, body, 580);
        w.ShowDialog();
    }
}
