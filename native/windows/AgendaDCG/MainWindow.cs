using System.Diagnostics;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;
using static AgendaDCG.Ui;

namespace AgendaDCG;

public class MainWindow : Window
{
    public static MainWindow? Current;
    readonly Grid root = new();
    readonly Border content = new();
    readonly StackPanel nav = new();
    readonly StackPanel footer = new() { Margin = new Thickness(12) };
    readonly Border toast = new() { CornerRadius = new CornerRadius(20), Padding = new Thickness(18, 10, 18, 10), Background = new SolidColorBrush(Color.FromArgb(235, 30, 30, 32)), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 24), Visibility = Visibility.Collapsed, IsHitTestVisible = false };
    string tab = "today";
    Store S => Store.I;

    // état de l'agenda
    string view = "month";
    DateTime month = new(DateTime.Today.Year, DateTime.Today.Month, 1);
    DateTime week = Data.Monday(DateTime.Today);
    string selected = Data.Iso(DateTime.Today);
    string? coursSubject;

    public MainWindow()
    {
        Current = this;
        Title = "Agenda DCG";
        var area = SystemParameters.WorkArea;
        Width = Math.Min(1180, area.Width * 0.94); Height = Math.Min(780, area.Height * 0.94); MinWidth = Math.Min(820, area.Width); MinHeight = Math.Min(560, area.Height);
        Background = Theme.Bg;
        FontFamily = Theme.Font;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Theme.Chrome(this);
        try { Icon = new BitmapImage(new Uri("pack://application:,,,/icon.png")); } catch { }
        root.Children.Add(content);
        root.Children.Add(Reader.Bar);
        root.Children.Add(toast);
        Content = root;
        S.Changed += () => Dispatcher.Invoke(Render);
        Updater.Changed += () => Dispatcher.Invoke(RenderFooter);
        Loaded += async (_, _) => { await Start(); _ = Updater.Loop(); };
        PreviewKeyDown += (_, e) =>
        {
            if (tab != "agenda" || Keyboard.FocusedElement is TextBox) return;
            if (e.Key == Key.Left) { Go(-1); e.Handled = true; }
            if (e.Key == Key.Right) { Go(1); e.Handled = true; }
        };
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMinutes(2) };
        timer.Tick += async (_, _) => { if (S.Profile != null) await SafeRefresh(); };
        timer.Start();
    }

    public void ShowToast(string msg)
    {
        toast.Child = T(msg, 13, FontWeights.SemiBold, Brushes.White);
        toast.Visibility = Visibility.Visible;
        toast.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(200)));
        var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        t.Tick += (_, _) => { t.Stop(); toast.Visibility = Visibility.Collapsed; };
        t.Start();
    }

    async Task Start()
    {
        if (Environment.GetEnvironmentVariable("AGENDA_DEMO") == "1") { Demo.Load(); var t = (Environment.GetEnvironmentVariable("AGENDA_TAB") ?? "today").Split('-'); tab = t[0]; if (t.Length > 1) view = t[1]; ShowShell(); return; }
        try
        {
            S.Profile = await Api.Get<Profile>("profile");
            ShowShell();
            await SafeRefresh();
        }
        catch (ApiException e) when (e.Status == 401) { ShowLogin(); }
        catch { S.Offline = true; ShowLogin(); }
    }

    async Task SafeRefresh()
    {
        try { await S.Refresh(); }
        catch (ApiException e) when (e.Status == 401) { ShowLogin(); }
    }

    // ---------- Connexion ----------
    void ShowLogin()
    {
        var name = Input(Properties.Name);
        var pass = new PasswordBox();
        var pin = new PasswordBox { MaxLength = 6 };
        var err = T("", 13, null, Theme.Accent);
        var hint = T("Connecte-toi avec ton prénom.", 14, null, Theme.Text2);
        var passRow = Stacked("Mot de passe de la classe", pass);
        var pinRow = Stacked("Code perso (6 chiffres)", pin);
        pinRow.Visibility = Visibility.Collapsed;
        var step = 0; var exists = true;
        Button? go = null;
        async void Next()
        {
            err.Text = ""; go!.IsEnabled = false;
            try
            {
                if (step == 0)
                {
                    exists = (await Api.Call<System.Text.Json.JsonElement>(HttpMethod.Post, "profile/check", new { name = name.Text })).GetProperty("exists").GetBoolean();
                    step = 1;
                    name.IsEnabled = false; passRow.Visibility = Visibility.Collapsed; pinRow.Visibility = Visibility.Visible;
                    hint.Text = exists ? "Entre ton code perso à 6 chiffres." : "Crée ton code perso à 6 chiffres (garde-le bien).";
                    go.Content = T(exists ? "Se connecter" : "Créer mon compte", 13, FontWeights.SemiBold, Brushes.White);
                    pin.Focus();
                }
                else
                {
                    S.Profile = await Api.Call<Profile>(HttpMethod.Post, "profile/login", new { name = name.Text, pin = pin.Password, password = pass.Password, create = !exists });
                    Properties.Name = S.Profile.Name;
                    ShowShell();
                    await SafeRefresh();
                }
            }
            catch (Exception e) { err.Text = e.Message; }
            finally { go.IsEnabled = true; }
        }
        go = Btn("Continuer", Next, primary: true);
        go.IsDefault = true;
        go.HorizontalAlignment = HorizontalAlignment.Stretch;
        go.Padding = new Thickness(16, 11, 16, 11);
        var logo = new Image { Source = new BitmapImage(new Uri("pack://application:,,,/icon.png")), Width = 96, Height = 96 };
        var title = T("Agenda DCG", 30, FontWeights.Bold); title.HorizontalAlignment = HorizontalAlignment.Center;
        hint.HorizontalAlignment = HorizontalAlignment.Center;
        var form = V(12, logo, title, hint, Stacked("Prénom", name), passRow, pinRow, err, go);
        if (S.Offline) form.Children.Add(T("Pas de connexion internet", 13, null, Theme.Text2));
        var card = Card(form, 34);
        card.Width = 460; card.HorizontalAlignment = HorizontalAlignment.Center; card.VerticalAlignment = VerticalAlignment.Center;
        content.Child = card;
        _ = CheckClassSession(passRow);
        name.Focus();
    }

    static FrameworkElement Stacked(string label, UIElement input) => V(5, T(label, 12, FontWeights.SemiBold, Theme.Text2), input);

    static async Task CheckClassSession(FrameworkElement passRow)
    {
        try { if ((await Api.Raw(HttpMethod.Get, "me")).Status == 200) passRow.Visibility = Visibility.Collapsed; } catch { }
    }

    // ---------- Coquille ----------
    void ShowShell()
    {
        var g = new Grid();
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(210) });
        g.ColumnDefinitions.Add(new ColumnDefinition());
        var side = new DockPanel { Background = Theme.Side };
        DockPanel.SetDock(footer, Dock.Bottom);
        side.Children.Add(footer);
        nav.Margin = new Thickness(12, 18, 12, 0);
        var brand = H(10, new Image { Source = new BitmapImage(new Uri("pack://application:,,,/icon.png")), Width = 30, Height = 30 }, T("Agenda DCG", 16, FontWeights.Bold));
        brand.Margin = new Thickness(20, 20, 12, 0);
        DockPanel.SetDock(brand, Dock.Top);
        side.Children.Add(brand);
        side.Children.Add(nav);
        g.Children.Add(side);
        var page = new Border();
        Grid.SetColumn(page, 1);
        g.Children.Add(page);
        content.Child = g;
        pageHost = page;
        Render();
    }

    Border? pageHost;

    void Render()
    {
        if (pageHost == null || S.Profile == null) return;
        nav.Children.Clear();
        foreach (var (id, label, glyph) in new[] { ("today", "Aujourd'hui", ""), ("agenda", "Agenda", ""), ("cours", "Cours", ""), ("reviser", "Réviser", ""), ("settings", "Réglages", "") })
        {
            var row = H(12, Icon(glyph, 16, id == tab ? Theme.Accent : Theme.Text2), T(label, 14, id == tab ? FontWeights.SemiBold : FontWeights.Normal, id == tab ? Theme.Accent : Theme.Text));
            var item = new Border { Child = row, Padding = new Thickness(10, 8, 10, 8), CornerRadius = new CornerRadius(7), Background = id == tab ? Theme.AccentSoft : Brushes.Transparent, Cursor = Cursors.Hand, Margin = new Thickness(0, 0, 0, 3) };
            item.MouseLeftButtonUp += (_, _) => { tab = id; Render(); };
            nav.Children.Add(item);
        }
        RenderFooter();
        pageHost.Child = tab switch
        {
            "agenda" => AgendaPage(),
            "cours" => CoursPage(),
            "reviser" => ReviserPage(),
            "settings" => SettingsPage(),
            _ => TodayPage(),
        };
    }

    void RenderFooter()
    {
        footer.Children.Clear();
        if (Updater.Ready) footer.Children.Add(Btn("Mise à jour prête · Redémarrer", Updater.ApplyAndRestart, primary: true));
        if (S.Offline) footer.Children.Add(T("Hors ligne", 12, null, Theme.Text2));
        footer.Children.Add(H(8, Icon("", 14, Theme.Text2), T(S.Name, 13, null, Theme.Text2)));
        foreach (FrameworkElement f in footer.Children) f.Margin = new Thickness(0, 6, 0, 0);
    }

    static UIElement Page(string title, UIElement body, params UIElement[] actions)
    {
        var dock = new DockPanel { Margin = new Thickness(28, 20, 28, 0) };
        var head = new DockPanel { Margin = new Thickness(0, 0, 0, 14) };
        var right = H(8, actions); DockPanel.SetDock(right, Dock.Right);
        head.Children.Add(right);
        head.Children.Add(T(title, 26, FontWeights.Bold));
        DockPanel.SetDock(head, Dock.Top);
        dock.Children.Add(head);
        dock.Children.Add(body);
        return dock;
    }

    static ScrollViewer Scroll(UIElement e) => new() { Content = e, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(0, 0, 0, 24) };

    // ---------- Événements ----------
    public static UIElement EventRow(AgendaEvent e, bool showDate = false)
    {
        var s = Store.I;
        var done = s.IsDone(e);
        var parts = new List<string> { Data.KindLabel(e.Kind) };
        if (showDate) parts.Add(Data.Relative(e.Date));
        if (e.TimeLabel != null) parts.Add(e.TimeLabel);
        if (!string.IsNullOrEmpty(e.Subject)) parts.Add(e.Subject);
        var title = T(e.Title, 14, FontWeights.SemiBold, done ? Theme.Text2 : Theme.Text);
        if (done) title.TextDecorations = TextDecorations.Strikethrough;
        var g = new DockPanel();
        if (e.IsDeadline)
        {
            var check = IconBtn(done ? "" : "", async () => await Try(() => s.ToggleDone(e)), done ? "Marquer à faire" : "Marquer fait");
            ((TextBlock)check.Content).Foreground = done ? Theme.Green : Theme.Text2;
            ((TextBlock)check.Content).FontSize = 18;
            DockPanel.SetDock(check, Dock.Right);
            g.Children.Add(check);
        }
        var bar = Bar(Theme.Of(e.Color)); DockPanel.SetDock(bar, Dock.Left); g.Children.Add(bar);
        var ic = Icon(Data.KindGlyph(e.Kind), 15, Theme.Of(e.Color)); ic.Margin = new Thickness(0, 0, 12, 0); DockPanel.SetDock(ic, Dock.Left); g.Children.Add(ic);
        g.Children.Add(V(2, title, T(string.Join(" · ", parts), 12, null, Theme.Text2)));
        var card = Card(g, 10);
        card.Margin = new Thickness(0, 0, 0, 8);
        card.Cursor = Cursors.Hand;
        card.MouseLeftButtonUp += (_, ev) => { if (ev.OriginalSource is not TextBlock { FontFamily: var f } || f != Theme.Icons) { if (e.IsClass) Dialogs.ClassDetail(e); else Dialogs.EventDetail(e); } };
        return card;
    }

    UIElement TodayPage()
    {
        var today = Data.Iso(DateTime.Today);
        var body = new StackPanel { MaxWidth = 760, HorizontalAlignment = HorizontalAlignment.Left };
        body.Children.Add(T(Data.Cap(Data.LongDate(today)), 16, null, Theme.Text2));
        var h = DateTime.Now.Hour;
        body.Children.Add(T($"{(h >= 5 && h < 18 ? "Bonjour" : "Bonsoir")}, {S.Name}", 30, FontWeights.Bold));
        if (Data.Holiday(today) is { } hol) body.Children.Add(T($"Jour férié : {hol}", 14, null, Theme.Orange));
        else if (S.IsCompanyDay(today)) body.Children.Add(T("Journée en entreprise", 14, null, Theme.Text2));
        void Section(string title, List<AgendaEvent> list, string empty, bool showDate)
        {
            var t = T(title, 20, FontWeights.Bold); t.Margin = new Thickness(0, 22, 0, 8);
            body.Children.Add(t);
            if (list.Count == 0) body.Children.Add(T(empty, 14, null, Theme.Text2));
            foreach (var e in list) body.Children.Add(EventRow(e, showDate));
        }
        Section("Aujourd'hui", S.On(today), S.IsCompanyDay(today) ? "Journée en entreprise, pas de cours." : "Rien de prévu aujourd'hui.", false);
        var late = S.Events.Where(e => e.IsDeadline && string.CompareOrdinal(e.Date, today) < 0 && (DateTime.Today - Data.Parse(e.Date)).Days <= 14 && !S.IsDone(e)).OrderBy(e => e.SortKey).ToList();
        if (late.Count > 0) Section("Pas encore fait", late, "", true);
        var upcoming = S.Events.Where(e => e.IsDeadline && string.CompareOrdinal(e.Date, today) > 0 && (Data.Parse(e.Date) - DateTime.Today).Days <= 21).OrderBy(e => e.SortKey).ToList();
        Section("À venir", upcoming, "Aucune échéance dans les 3 prochaines semaines.", true);
        return Page("Aujourd'hui", Scroll(body), Btn("+ Ajouter", () => Dialogs.EventEditor(null, today), primary: true));
    }

    // ---------- Agenda ----------
    void Go(int step)
    {
        if (view == "month") month = month.AddMonths(step); else week = week.AddDays(7 * step);
        slideFrom = step;
        Render();
    }

    int slideFrom;
    double wheelX;

    UIElement AgendaPage()
    {
        if (view == "cahier") return CahierPage();
        var title = view == "month"
            ? Data.Cap(month.ToString("MMMM yyyy", Data.Fr))
            : $"Semaine {System.Globalization.ISOWeek.GetWeekOfYear(week)} · {week.Day} – {week.AddDays(6).ToString("d MMMM", Data.Fr)}";
        var titleBtn = Btn(H(6, T(title, 22, FontWeights.Bold), Icon("", 12)), () => Dialogs.MonthPicker(month, d => { month = new DateTime(d.Year, d.Month, 1); week = Data.Monday(d); selected = Data.Iso(d); Render(); }));
        titleBtn.Background = Brushes.Transparent; titleBtn.Padding = new Thickness(0);
        var toggle = H(0,
            Btn("Mois", () => { view = "month"; month = new DateTime(Data.Parse(selected).Year, Data.Parse(selected).Month, 1); Render(); }, primary: view == "month"),
            Btn("Semaine", () => { view = "week"; week = Data.Monday(Data.Parse(selected)); Render(); }, primary: view == "week"),
            Btn("Cahier", () => { view = "cahier"; Render(); }, primary: view == "cahier"));
        var head = new DockPanel { Margin = new Thickness(0, 0, 0, 10) };
        var right = H(6, toggle, Btn("Aujourd'hui", () => { month = new(DateTime.Today.Year, DateTime.Today.Month, 1); week = Data.Monday(DateTime.Today); selected = Data.Iso(DateTime.Today); Render(); }),
            IconBtn("", () => Go(-1), "Précédent"), IconBtn("", () => Go(1), "Suivant"), Btn("+ Ajouter", () => Dialogs.EventEditor(null, selected), primary: true));
        DockPanel.SetDock(right, Dock.Right);
        head.Children.Add(right);
        head.Children.Add(titleBtn);

        Panel grid = view == "month" ? MonthGrid() : WeekGrid();
        // glissement horizontal (pavé tactile / molette inclinable)
        grid.Background = Brushes.Transparent;
        grid.AddHandler(UIElement.PreviewMouseWheelEvent, new MouseWheelEventHandler((_, e) =>
        {
            if (Keyboard.Modifiers.HasFlag(ModifierKeys.Shift)) { Go(e.Delta > 0 ? -1 : 1); e.Handled = true; }
        }));
        if (slideFrom != 0)
        {
            var tt = new TranslateTransform(40 * slideFrom, 0);
            grid.RenderTransform = tt;
            tt.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(40 * slideFrom, 0, TimeSpan.FromMilliseconds(260)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
            grid.BeginAnimation(OpacityProperty, new DoubleAnimation(0.2, 1, TimeSpan.FromMilliseconds(260)));
            slideFrom = 0;
        }

        var dock = new DockPanel { Margin = new Thickness(20, 16, 20, 0) };
        DockPanel.SetDock(head, Dock.Top);
        dock.Children.Add(head);
        if (view == "month")
        {
            var list = new StackPanel();
            list.Children.Add(T(Data.Cap(Data.LongDate(selected)), 16, FontWeights.Bold));
            if (Data.Holiday(selected) is { } h) list.Children.Add(T(h, 13, null, Theme.Orange));
            else if (S.IsCompanyDay(selected)) list.Children.Add(T("Journée en entreprise", 13, null, Theme.Text2));
            var evs = S.On(selected);
            if (evs.Count == 0) list.Children.Add(T("Rien ce jour-là.", 14, null, Theme.Text2));
            foreach (var e in evs) list.Children.Add(EventRow(e));
            foreach (FrameworkElement f in list.Children) if (f is TextBlock) f.Margin = new Thickness(0, 0, 0, 6);
            var sv = Scroll(list); sv.Height = 210; sv.Margin = new Thickness(0, 10, 0, 0);
            DockPanel.SetDock(sv, Dock.Bottom);
            dock.Children.Add(sv);
        }
        dock.Children.Add(grid);
        return dock;
    }

    Panel MonthGrid()
    {
        var offset = ((int)month.DayOfWeek + 6) % 7;
        var count = DateTime.DaysInMonth(month.Year, month.Month);
        var rows = (int)Math.Ceiling((offset + count) / 7.0);
        var today = Data.Iso(DateTime.Today);
        var g = new Grid();
        for (var c = 0; c < 7; c++) g.ColumnDefinitions.Add(new ColumnDefinition());
        g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        for (var r = 0; r < rows; r++) g.RowDefinitions.Add(new RowDefinition());
        var names = new[] { "lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim." };
        for (var c = 0; c < 7; c++)
        {
            var t = T(names[c], 12, FontWeights.SemiBold, Theme.Text2); t.HorizontalAlignment = HorizontalAlignment.Center; t.Margin = new Thickness(0, 0, 0, 6);
            Grid.SetColumn(t, c); g.Children.Add(t);
        }
        for (var n = 1; n <= count; n++)
        {
            var i = offset + n - 1;
            var day = Data.Iso(month.AddDays(n - 1));
            var hol = Data.Holiday(day);
            var num = T(n.ToString(), 13, day == today ? FontWeights.Bold : FontWeights.Normal, day == today ? Brushes.White : (i % 7 >= 5 || hol != null) ? Theme.Text2 : Theme.Text);
            num.HorizontalAlignment = HorizontalAlignment.Center; num.VerticalAlignment = VerticalAlignment.Center;
            var badge = new Border { Width = 24, Height = 24, CornerRadius = new CornerRadius(12), Background = day == today ? Theme.Accent : Brushes.Transparent, Child = num, HorizontalAlignment = HorizontalAlignment.Left };
            var cell = new StackPanel();
            var top = H(4, badge);
            var note = hol ?? (S.IsCompanyDay(day) ? "Entreprise" : null);
            if (note != null) { var ht = T(note, 10, null, hol != null ? Theme.Orange : Theme.Text2); ht.VerticalAlignment = VerticalAlignment.Center; top.Children.Add(ht); }
            cell.Children.Add(top);
            var evs = S.On(day);
            foreach (var e in evs.Take(3))
            {
                var t = T(e.Title, 11); if (S.IsDone(e)) t.TextDecorations = TextDecorations.Strikethrough;
                cell.Children.Add(new Border { Child = t, Background = Theme.Of(e.Color, (byte)(S.IsDone(e) ? 25 : 60)), CornerRadius = new CornerRadius(4), Padding = new Thickness(4, 1, 4, 1), Margin = new Thickness(0, 2, 0, 0) });
            }
            if (evs.Count > 3) cell.Children.Add(T($"+{evs.Count - 3}", 11, null, Theme.Text2));
            var b = new Border { Child = cell, Padding = new Thickness(4), Margin = new Thickness(1), CornerRadius = new CornerRadius(8), BorderBrush = Theme.Line, BorderThickness = new Thickness(0, 1, 0, 0), Background = day == selected ? Theme.AccentSoft : Brushes.Transparent, Cursor = Cursors.Hand, ClipToBounds = true };
            var d = day;
            b.MouseLeftButtonUp += (_, e) => { if (e.ClickCount == 1) { selected = d; Render(); } };
            b.MouseLeftButtonDown += (_, e) => { if (e.ClickCount == 2) Dialogs.EventEditor(null, d); };
            Grid.SetRow(b, i / 7 + 1); Grid.SetColumn(b, i % 7);
            g.Children.Add(b);
        }
        return g;
    }

    const int StartH = 8, EndH = 19, HourH = 48;
    static int Min(string t) { var p = t.Split(':'); return int.Parse(p[0]) * 60 + (p.Length > 1 ? int.Parse(p[1]) : 0); }

    /// Semaine façon emploi du temps (ENT) : grille horaire 8 h – 19 h.
    Panel WeekGrid()
    {
        var today = Data.Iso(DateTime.Today);
        var days = Enumerable.Range(0, 7).Select(i => Data.Iso(week.AddDays(i))).Where((d, i) => i < 5 || S.On(d).Count > 0).ToList();
        var root = new DockPanel();
        var head = new Grid(); var allDay = new Grid(); var body = new Grid();
        foreach (var g in new[] { head, allDay, body })
        {
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(46) });
            foreach (var _ in days) g.ColumnDefinitions.Add(new ColumnDefinition());
        }
        var gut = T("Journée", 11, null, Theme.Text2); gut.HorizontalAlignment = HorizontalAlignment.Right; gut.Margin = new Thickness(0, 4, 6, 0);
        allDay.Children.Add(gut);
        var hours = new StackPanel();
        for (var h = StartH; h < EndH; h++) { var t = T($"{h} h", 11, null, Theme.Text2); t.Height = HourH; t.HorizontalAlignment = HorizontalAlignment.Right; t.Margin = new Thickness(0, -7, 6, 7); hours.Children.Add(t); }
        body.Children.Add(hours);
        for (var i = 0; i < days.Count; i++)
        {
            var day = days[i]; var d = Data.Parse(day);
            var num = T(d.Day.ToString(), 17, FontWeights.SemiBold, day == today ? Brushes.White : Theme.Text); num.HorizontalAlignment = HorizontalAlignment.Center; num.VerticalAlignment = VerticalAlignment.Center;
            var hd = V(2, T(d.ToString("ddd", Data.Fr), 12, null, Theme.Text2), new Border { Width = 32, Height = 32, CornerRadius = new CornerRadius(16), Background = day == today ? Theme.Accent : Brushes.Transparent, Child = num });
            foreach (FrameworkElement c in hd.Children) c.HorizontalAlignment = HorizontalAlignment.Center;
            hd.Margin = new Thickness(0, 0, 0, 6);
            Grid.SetColumn(hd, i + 1); head.Children.Add(hd);

            var chips = new StackPanel { Margin = new Thickness(2) };
            foreach (var e in S.On(day).Where(e => string.IsNullOrEmpty(e.Time) && !S.InClass(e)))
            {
                var ev = e;
                var t = T(e.Title, 11.5, FontWeights.SemiBold); if (S.IsDone(e)) t.TextDecorations = TextDecorations.Strikethrough;
                var chip = new Border { Child = t, Background = Theme.Of(e.Color, 50), CornerRadius = new CornerRadius(5), Padding = new Thickness(6, 3, 6, 3), Margin = new Thickness(0, 0, 0, 3), Cursor = Cursors.Hand };
                chip.MouseLeftButtonUp += (_, x) => { Dialogs.EventDetail(ev); x.Handled = true; };
                chips.Children.Add(chip);
            }
            Grid.SetColumn(chips, i + 1); allDay.Children.Add(chips);

            var insideAll = S.On(day).Where(S.InClass).ToList();
            var timed = S.On(day).Where(e => !string.IsNullOrEmpty(e.Time) && !S.InClass(e)).ToList();
            var note = Data.Holiday(day) ?? (S.IsCompanyDay(day) && timed.Count == 0 ? "Entreprise" : null);
            var canvas = new Canvas { Height = HourH * (EndH - StartH), Background = note != null ? Theme.Of("brown", 14) : day == selected ? Theme.Of("red", 10) : Brushes.Transparent, Margin = new Thickness(2, 0, 2, 0), ClipToBounds = true };
            for (var h = 0; h < EndH - StartH; h++) { var l = new Rectangle { Height = 1, Fill = Theme.Line }; Canvas.SetTop(l, h * HourH); l.SetBinding(WidthProperty, new System.Windows.Data.Binding("ActualWidth") { Source = canvas }); canvas.Children.Add(l); }
            if (note != null) { var nt = T(note, 12, FontWeights.SemiBold, Theme.Text2); nt.TextAlignment = TextAlignment.Center; Canvas.SetTop(nt, HourH * 4); nt.SetBinding(WidthProperty, new System.Windows.Data.Binding("ActualWidth") { Source = canvas }); canvas.Children.Add(nt); }
            var ends = new List<int>(); var lane = new List<int>();
            foreach (var e in timed) { var a0 = Min(e.Time!); var b0 = e.End != null ? Min(e.End) : a0 + 60; var li = ends.FindIndex(x => x <= a0); if (li < 0) { ends.Add(b0); li = ends.Count - 1; } else ends[li] = b0; lane.Add(li); }
            var n = Math.Max(1, ends.Count);
            for (var k = 0; k < timed.Count; k++)
            {
                var e = timed[k]; var ev = e;
                var a = Math.Max(Min(e.Time!), StartH * 60); var b = Math.Min(Math.Max(e.End != null ? Min(e.End) : a + 60, a + 30), EndH * 60);
                var inner = new StackPanel();
                var tt = new TextBlock { Text = S.RevTitle(e), FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = Theme.Text, TextWrapping = TextWrapping.Wrap };
                if (S.IsDone(e)) tt.TextDecorations = TextDecorations.Strikethrough;
                inner.Children.Add(tt);
                inner.Children.Add(T((e.TimeLabel ?? "") + (e.IsClass ? "" : " · " + Data.KindLabel(e.Kind)), 11, null, Theme.Text2));
                if (e.Revision && !S.HasLevels) inner.Children.Add(T("✨ Clique pour personnaliser", 11, FontWeights.SemiBold));
                foreach (var p in S.RevisionFor(e)) { var pt = T((S.IsSujetSlot(e) ? "✏️ " : "📖 ") + p.Label, 11, FontWeights.SemiBold); pt.TextTrimming = TextTrimming.CharacterEllipsis; inner.Children.Add(new Border { Child = pt, Background = Theme.Card, CornerRadius = new CornerRadius(4), Padding = new Thickness(4, 2, 4, 2), Margin = new Thickness(0, 3, 0, 0) }); }
                if (e.IsClass)
                    foreach (var task in insideAll.Where(x => Store.SameSubject(x.Subject, e.Subject)))
                    {
                        var tk = task;
                        var tt2 = T("• " + task.Title + ((task.Attachments?.Count ?? 0) > 0 ? " 📎" : ""), 11, FontWeights.SemiBold);
                        if (S.IsDone(task)) tt2.TextDecorations = TextDecorations.Strikethrough;
                        var chip = new Border { Child = tt2, Background = Theme.Card, CornerRadius = new CornerRadius(4), Padding = new Thickness(4, 2, 4, 2), Margin = new Thickness(0, 3, 0, 0) };
                        chip.MouseLeftButtonUp += (_, x) => { Dialogs.EventDetail(tk); x.Handled = true; };
                        inner.Children.Add(chip);
                    }
                var block = new Border { Child = inner, Background = Theme.Of(e.Color, (byte)(S.IsDone(e) ? 25 : e.IsClass ? 75 : 55)), BorderBrush = Theme.Of(e.Color), BorderThickness = new Thickness(3, 0, 0, 0), CornerRadius = new CornerRadius(6), Padding = new Thickness(6, 4, 4, 4), Height = (b - a) / 60.0 * HourH - 2, Cursor = Cursors.Hand };
                block.MouseLeftButtonUp += (_, x) => { if (ev.IsClass) Dialogs.ClassDetail(ev); else Dialogs.EventDetail(ev); x.Handled = true; };
                var laneI = lane[k];
                canvas.SizeChanged += (_, _) => { block.Width = Math.Max(10, canvas.ActualWidth / n - 3); Canvas.SetLeft(block, laneI * canvas.ActualWidth / n); };
                Canvas.SetTop(block, (a - StartH * 60) / 60.0 * HourH + 1);
                canvas.Children.Add(block);
            }
            if (day == today)
            {
                var now = DateTime.Now.Hour * 60 + DateTime.Now.Minute;
                if (now > StartH * 60 && now < EndH * 60) { var line = new Rectangle { Height = 2, Fill = Theme.Accent }; line.SetBinding(WidthProperty, new System.Windows.Data.Binding("ActualWidth") { Source = canvas }); Canvas.SetTop(line, (now - StartH * 60) / 60.0 * HourH); canvas.Children.Add(line); }
            }
            var dd = day;
            canvas.MouseLeftButtonDown += (_, x) => { if (x.ClickCount == 2) Dialogs.EventEditor(null, dd); else selected = dd; };
            Grid.SetColumn(canvas, i + 1); body.Children.Add(canvas);
        }
        DockPanel.SetDock(head, Dock.Top); root.Children.Add(head);
        var sep = new Border { BorderBrush = Theme.Line, BorderThickness = new Thickness(0, 0, 0, 1), Child = allDay, Margin = new Thickness(0, 0, 0, 8) };
        DockPanel.SetDock(sep, Dock.Top); root.Children.Add(sep);
        root.Children.Add(new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        return root;
    }

    /// Cahier de texte : devoirs et évaluations à rendre, groupés par date.
    UIElement CahierPage()
    {
        var today = Data.Iso(DateTime.Today);
        var weekAgo = DateTime.UtcNow.AddDays(-7).ToString("yyyy-MM-ddTHH:mm:ss");
        var work = S.Events.Where(e => e.IsDeadline).OrderBy(e => e.SortKey).ToList();
        var todo = work.Where(e => string.CompareOrdinal(e.Date, today) >= 0 && !S.IsDone(e)).ToList();
        var late = work.Where(e => string.CompareOrdinal(e.Date, today) < 0 && !S.IsDone(e) && (DateTime.Today - Data.Parse(e.Date)).Days <= 30).ToList();
        var fresh = work.Count(e => string.CompareOrdinal(e.Date, today) >= 0 && string.CompareOrdinal(e.CreatedAt ?? "", weekAgo) >= 0);
        var body = new StackPanel { MaxWidth = 760, HorizontalAlignment = HorizontalAlignment.Left };
        body.Children.Add(T(todo.Count == 0 ? "Tout est fait 🎉" : $"{todo.Count} {(todo.Count > 1 ? "travaux" : "travail")} à faire" + (fresh > 0 ? $" · {fresh} nouveau{(fresh > 1 ? "x" : "")} cette semaine" : ""), 14, null, Theme.Text2));
        void Group(string title, IEnumerable<AgendaEvent> list, bool showDate)
        {
            var h = T(title.ToUpper(), 12, FontWeights.SemiBold, Theme.Text2); h.Margin = new Thickness(0, 20, 0, 8); body.Children.Add(h);
            foreach (var e in list)
            {
                var row = EventRow(e, showDate);
                if (string.CompareOrdinal(e.CreatedAt ?? "", weekAgo) >= 0)
                {
                    var g = new Grid(); g.Children.Add(row);
                    var tag = T("Nouveau", 11, FontWeights.Bold, Theme.Blue); tag.HorizontalAlignment = HorizontalAlignment.Right; tag.VerticalAlignment = VerticalAlignment.Top; tag.Margin = new Thickness(0, 8, 52, 0);
                    g.Children.Add(tag); body.Children.Add(g);
                }
                else body.Children.Add(row);
            }
        }
        if (late.Count > 0) Group("En retard", late, true);
        foreach (var d in todo.Select(e => e.Date).Distinct())
        {
            var n = (Data.Parse(d) - DateTime.Today).Days;
            Group(n == 0 ? "Pour aujourd'hui" : n == 1 ? "Pour demain" : $"Pour {Data.LongDate(d)}", todo.Where(e => e.Date == d), false);
        }
        var toggle = H(0, Btn("Mois", () => { view = "month"; Render(); }), Btn("Semaine", () => { view = "week"; Render(); }), Btn("Cahier", () => { }, primary: true));
        return Page("Cahier de texte", Scroll(body), toggle, Btn("+ Nouveau devoir", () => Dialogs.EventEditor(null, Data.Iso(DateTime.Today.AddDays(1)), "devoir"), primary: true));
    }

    // ---------- Cours ----------
    UIElement CoursPage()
    {
        coursSubject ??= S.CourseSubjects().FirstOrDefault() ?? Data.Subjects[0];
        var list = new StackPanel { Margin = new Thickness(0, 0, 16, 0) };
        foreach (var s in Data.Subjects.Concat(S.CourseSubjects().Except(Data.Subjects)))
        {
            var n = S.Chapters.Count(c => c.Subject == s);
            var row = new DockPanel();
            if (n > 0) { var c = T(n.ToString(), 13, null, Theme.Text2); DockPanel.SetDock(c, Dock.Right); row.Children.Add(c); }
            row.Children.Add(T(s, 13, s == coursSubject ? FontWeights.SemiBold : FontWeights.Normal, n > 0 ? Theme.Text : Theme.Text2));
            var item = new Border { Child = row, Padding = new Thickness(10, 7, 10, 7), CornerRadius = new CornerRadius(7), Background = s == coursSubject ? Theme.Selected : Brushes.Transparent, Cursor = Cursors.Hand };
            var sub = s;
            item.MouseLeftButtonUp += (_, _) => { coursSubject = sub; Render(); };
            list.Children.Add(item);
        }
        var chapters = new StackPanel();
        chapters.Children.Add(T(coursSubject, 22, FontWeights.Bold));
        var chs = S.Chapters.Where(c => c.Subject == coursSubject).ToList();
        if (chs.Count == 0) chapters.Children.Add(T("Aucun chapitre pour l'instant.", 14, null, Theme.Text2));
        foreach (var ch in chs)
        {
            var card = Card(V(8, T(ch.Title, 15, FontWeights.SemiBold), Dialogs.ChapterFiles(ch, false, false)));
            card.Margin = new Thickness(0, 12, 0, 0);
            chapters.Children.Add(card);
        }
        var g = new Grid();
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(290) });
        g.ColumnDefinitions.Add(new ColumnDefinition());
        g.Children.Add(Scroll(list));
        var right = Scroll(chapters); Grid.SetColumn(right, 1); g.Children.Add(right);
        return Page("Cours", g);
    }

    // ---------- Notes ----------
    UIElement NotesPage()
    {
        var all = S.Profile?.Grades ?? new();
        var subjects = Data.Subjects.Where(s => all.Any(g => g.Subject == s)).Concat(all.Select(g => g.Subject).Distinct().Except(Data.Subjects)).ToList();
        var avgs = subjects.Select(s => Data.Average(all.Where(g => g.Subject == s))).Where(a => a != null).Select(a => a!.Value).ToList();
        var body = new StackPanel();
        body.Children.Add(T("Moyenne générale", 14, null, Theme.Text2));
        body.Children.Add(T(avgs.Count == 0 ? "–" : Data.Num(avgs.Average(), 2), 44, FontWeights.Bold));
        body.Children.Add(T("Notes privées : toi seul les vois.", 12, null, Theme.Text2));
        if (subjects.Count == 0) body.Children.Add(T("Ajoute tes notes pour suivre tes moyennes.", 14, null, Theme.Text2));
        var wrap = new WrapPanel { Margin = new Thickness(0, 12, 0, 0) };
        foreach (var s in subjects)
        {
            var gs = all.Where(g => g.Subject == s).OrderBy(g => g.Date).ToList();
            var head = new DockPanel();
            var avg = T(Data.Average(gs) is { } a ? Data.Num(a, 2) : "–", 20, FontWeights.Bold); DockPanel.SetDock(avg, Dock.Right);
            head.Children.Add(avg); head.Children.Add(T(s, 14, FontWeights.SemiBold));
            var chart = Chart(gs, 300, 70);
            var card = Card(V(8, head, chart, T($"{gs.Count} note{(gs.Count > 1 ? "s" : "")}", 12, null, Theme.Text2)));
            card.Width = 330; card.Margin = new Thickness(0, 0, 14, 14); card.Cursor = Cursors.Hand;
            var sub = s;
            card.MouseLeftButtonUp += (_, _) => Dialogs.SubjectDetail(sub);
            wrap.Children.Add(card);
        }
        body.Children.Add(wrap);
        return Page("Notes", Scroll(body), Btn("+ Ajouter une note", () => Dialogs.GradeEditor(null, null), primary: true));
    }

    public static Canvas Chart(List<Grade> gs, double w, double h)
    {
        var c = new Canvas { Width = w, Height = h, ClipToBounds = false };
        if (gs.Count == 0) return c;
        double X(int i) => gs.Count == 1 ? w / 2 : 6 + i * (w - 12) / (gs.Count - 1);
        double Y(double v) => h - 4 - v / 20 * (h - 8);
        if (Data.Average(gs) is { } avg)
            c.Children.Add(new Line { X1 = 0, X2 = w, Y1 = Y(avg), Y2 = Y(avg), Stroke = Theme.Text2, StrokeThickness = 1, StrokeDashArray = new DoubleCollection { 4, 3 } });
        var poly = new Polyline { Stroke = Theme.Accent, StrokeThickness = 2 };
        for (var i = 0; i < gs.Count; i++) poly.Points.Add(new Point(X(i), Y(gs[i].On20)));
        c.Children.Add(poly);
        for (var i = 0; i < gs.Count; i++)
        {
            var dot = new Ellipse { Width = 7, Height = 7, Fill = gs[i].Category == "entrainement" ? Theme.Card : Theme.Accent, Stroke = Theme.Accent, StrokeThickness = 1.5, ToolTip = $"{Data.Num(gs[i].Value, 2)}/{Data.Num(gs[i].OutOf)} · {gs[i].Title}" };
            Canvas.SetLeft(dot, X(i) - 3.5); Canvas.SetTop(dot, Y(gs[i].On20) - 3.5);
            c.Children.Add(dot);
        }
        return c;
    }

    // ---------- Réviser (Objectif DCG) ----------
    public static void OpenRevise() => Process.Start(new ProcessStartInfo(Api.Revise.ToString()) { UseShellExecute = true });

    UIElement ReviserPage()
    {
        var today = Data.Iso(DateTime.Today);
        var logo = new Image { Width = 72, Height = 72, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 0, 18, 0) };
        try { logo.Source = new BitmapImage(new Uri(Api.Revise, "icon-192.png")); } catch { }
        var desc = new TextBlock { Text = "Plus de 3 500 flash cards, des quiz, une pile du jour et une ligue pour réviser le droit fiscal (UE4), le droit des sociétés (UE2) et la finance (UE6).", TextWrapping = TextWrapping.Wrap, Foreground = Theme.Text2, FontSize = 14, Margin = new Thickness(0, 6, 0, 14) };
        var open = Btn("Ouvrir Objectif DCG", OpenRevise, primary: true); open.HorizontalAlignment = HorizontalAlignment.Left;
        var row = new DockPanel();
        DockPanel.SetDock(logo, Dock.Left); row.Children.Add(logo);
        row.Children.Add(V(0, T("Objectif DCG", 20, FontWeights.Bold), desc, open));
        var body = new StackPanel { MaxWidth = 760, HorizontalAlignment = HorizontalAlignment.Left };
        body.Children.Add(Card(row, 20));
        var next = S.Events.Where(e => e.IsDeadline && string.CompareOrdinal(e.Date, today) >= 0 && !S.IsDone(e)).OrderBy(e => e.SortKey).Take(4).ToList();
        if (next.Count > 0)
        {
            var h = T("À réviser en priorité", 20, FontWeights.Bold); h.Margin = new Thickness(0, 24, 0, 8); body.Children.Add(h);
            foreach (var e in next) body.Children.Add(EventRow(e, true));
            var covered = next.Any(e => new[] { "UE2", "UE4", "UE6" }.Contains((e.Subject ?? "").Split(" · ")[0]));
            body.Children.Add(new TextBlock { Text = covered ? "UE2, UE4 et UE6 sont dans Objectif DCG : lance une révision express avant le contrôle." : "Ces matières ne sont pas encore dans Objectif DCG : appuie-toi sur les fiches de l'onglet Cours.", TextWrapping = TextWrapping.Wrap, Foreground = Theme.Text2, FontSize = 13 });
        }
        body.Children.Add(new TextBlock { Text = "Objectif DCG est une appli créée par un camarade de la classe. Ta progression y est gardée sur son site, avec ton propre compte.", TextWrapping = TextWrapping.Wrap, Foreground = Theme.Text2, FontSize = 12, Margin = new Thickness(0, 20, 0, 0) });
        return Page("Réviser", Scroll(body));
    }

    // ---------- Réglages ----------
    UIElement SettingsPage()
    {
        var prefs = S.Profile?.Prefs ?? new Prefs();
        CheckBox Toggle(string label, bool value, Action<Prefs, bool> apply)
        {
            var cb = new CheckBox { Content = T(label, 14), IsChecked = value, Margin = new Thickness(0, 6, 0, 6), VerticalContentAlignment = VerticalAlignment.Center };
            cb.Click += async (_, _) =>
            {
                var p = new Prefs { OnNew = prefs.OnNew, Daily = prefs.Daily, Weekly = prefs.Weekly, Before = prefs.Before.ToList() };
                apply(p, cb.IsChecked == true);
                await Try(() => S.SavePrefs(p));
            };
            return cb;
        }
        var notif = V(0,
            Toggle("À chaque nouvelle évaluation", prefs.OnNew, (p, on) => p.OnNew = on),
            Toggle("Résumé chaque matin (7 h)", prefs.Daily, (p, on) => p.Daily = on),
            Toggle("Résumé de la semaine (dimanche 18 h)", prefs.Weekly, (p, on) => p.Weekly = on),
            Toggle("Rappel la veille (19 h)", prefs.Before.Contains(1), (p, on) => p.Before = on ? p.Before.Append(1).Distinct().ToList() : p.Before.Where(d => d != 1).ToList()),
            Toggle("Rappel 2 jours avant", prefs.Before.Contains(2), (p, on) => p.Before = on ? p.Before.Append(2).Distinct().ToList() : p.Before.Where(d => d != 2).ToList()),
            Toggle("Rappel 7 jours avant", prefs.Before.Contains(7), (p, on) => p.Before = on ? p.Before.Append(7).Distinct().ToList() : p.Before.Where(d => d != 7).ToList()),
            T("Les rappels s'affichent sur ce PC, même quand l'agenda est fermé.", 12, null, Theme.Text2));
        var app = V(8,
            Field("Version", T(Updater.Version, 14)),
            Field("Mise à jour", T(Updater.Status, 14)),
            H(8, Btn("Rechercher les mises à jour", async () => { await Updater.Check(); Render(); }),
                 Btn("Ouvrir l'agenda dans le navigateur", () => Process.Start(new ProcessStartInfo(Api.Site.ToString()) { UseShellExecute = true }))));
        var account = V(8, Field("Connecté en tant que", T(S.Name, 14, FontWeights.SemiBold)),
            Btn("Se déconnecter", async () =>
            {
                try { await Api.Raw(HttpMethod.Post, "profile/logout"); } catch { }
                S.Profile = null; S.Events.Clear(); S.Chapters.Clear(); pageHost = null;
                Notifier.Schedule(new(), null);
                ShowLogin();
            }, danger: true));
        account.Children[^1].SetValue(HorizontalAlignmentProperty, HorizontalAlignment.Left);
        UIElement Section(string title, UIElement inner) { var t = T(title, 13, FontWeights.SemiBold, Theme.Text2); t.Margin = new Thickness(4, 18, 0, 6); return V(0, t, Card(inner)); }
        var body = new StackPanel { MaxWidth = 640, HorizontalAlignment = HorizontalAlignment.Left };
        body.Children.Add(Section("Compte", account));
        body.Children.Add(Section("Notifications", notif));
        var past = new StackPanel();
        var list = S.PastHomework();
        if (list.Count == 0) past.Children.Add(T("Les sujets joints aux devoirs apparaîtront ici une fois la date passée.", 13, null, Theme.Text2));
        foreach (var e in list)
        {
            var h = T($"{e.Title} · {Data.LongDate(e.Date)}", 13, FontWeights.SemiBold); h.Margin = new Thickness(0, 6, 0, 2); past.Children.Add(h);
            foreach (var f in e.Attachments!) { var ff = f; var b = Btn("📄 " + f.Name, async () => await Try(async () => { var p = await S.Download(ff); Process.Start(new ProcessStartInfo(p) { UseShellExecute = true }); })); b.HorizontalAlignment = HorizontalAlignment.Left; b.Margin = new Thickness(0, 2, 0, 2); past.Children.Add(b); }
        }
        var lv = Btn(S.HasLevels ? "Modifier mon niveau par matière" : "Personnaliser mes révisions (1 min)", () => { Dialogs.LevelsSurvey(); Render(); }, primary: !S.HasLevels);
        lv.HorizontalAlignment = HorizontalAlignment.Left;
        body.Children.Add(Section("Révisions", lv));
        body.Children.Add(Section("Devoirs passés", past));
        body.Children.Add(Section("Application", app));
        return Page("Réglages", Scroll(body));
    }
}

static class Properties
{
    static readonly string File = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AgendaDCG", "name.txt");
    public static string Name
    {
        get { try { return System.IO.File.ReadAllText(File); } catch { return ""; } }
        set { try { System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(File)!); System.IO.File.WriteAllText(File, value); } catch { } }
    }
}
