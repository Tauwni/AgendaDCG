using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgendaDCG;

public record HistoryEntry(string? By, string? At, string? Action);

public class AgendaEvent
{
    public string Id { get; set; } = "";
    public string Kind { get; set; } = "eval";
    public string Title { get; set; } = "";
    public string? Subject { get; set; }
    public string Date { get; set; } = "";
    public string? Time { get; set; }
    public string? Color { get; set; }
    public string? Notes { get; set; }
    public List<string>? Chapters { get; set; }
    public string? CreatedBy { get; set; }
    public string? CreatedAt { get; set; }
    public string? UpdatedBy { get; set; }
    public string? End { get; set; }
    public List<PdfFile>? Attachments { get; set; }
    [JsonIgnore] public bool Revision { get; set; }
    [JsonIgnore] public bool IsDeadline => Data.Deadline.Contains(Kind);
    [JsonIgnore] public bool IsClass => Id.StartsWith("edt:");
    [JsonIgnore] public string? TimeLabel => string.IsNullOrEmpty(Time) ? null : End == null ? Time : $"{Time}–{End}";
    [JsonIgnore] public string SortKey => Date + (Time ?? "");
}

/// Emploi du temps fixe, lu dans public/schedule.json (modifiable sans mettre à jour l'app).
public class Schedule
{
    public class Slot { public int Day { get; set; } public string Start { get; set; } = ""; public string End { get; set; } = ""; public string Subject { get; set; } = ""; public string Title { get; set; } = ""; public string Color { get; set; } = "blue"; public string? Kind { get; set; } }
    public List<Slot> Classes { get; set; } = new();
    public List<int> CompanyDays { get; set; } = new();
    public string? From { get; set; }
    public string? To { get; set; }
    public List<string>? Skip { get; set; }

    bool InTerm(string day) => (From == null || string.CompareOrdinal(day, From) >= 0) && (To == null || string.CompareOrdinal(day, To) <= 0) && !(Skip ?? new()).Contains(day) && Data.Holiday(day) == null;
    public List<AgendaEvent> On(string day)
    {
        if (!InTerm(day)) return new();
        var wd = (int)Data.Parse(day).DayOfWeek;
        return Classes.Select((c, i) => (c, i)).Where(x => x.c.Day == wd).Select(x => new AgendaEvent
        {
            Id = $"edt:{day}:{x.i}", Kind = "cours", Title = x.c.Title, Subject = x.c.Subject, Date = day, Time = x.c.Start, End = x.c.End, Color = x.c.Color, Chapters = new(), Revision = x.c.Kind == "revision",
        }).ToList();
    }
    public bool IsCompanyDay(string day) => InTerm(day) && CompanyDays.Contains((int)Data.Parse(day).DayOfWeek);
}

public class PdfFile
{
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public long? Size { get; set; }
    public bool Locked { get; set; }
}

public class Chapter
{
    public string Id { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Title { get; set; } = "";
    public Dictionary<string, PdfFile?> Files { get; set; } = new();
    public PdfFile? File(string slot) => Files.TryGetValue(slot, out var f) ? f : null;
}

public class Grade
{
    public string Id { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Title { get; set; } = "";
    public string Date { get; set; } = "";
    public string Category { get; set; } = "controle";
    public double Value { get; set; }
    public double OutOf { get; set; } = 20;
    public double Coef { get; set; } = 1;
    [JsonIgnore] public double On20 => OutOf > 0 ? Value / OutOf * 20 : 0;
}

public class Prefs
{
    public bool OnNew { get; set; }
    public bool Daily { get; set; }
    public bool Weekly { get; set; }
    public List<int> Before { get; set; } = new();
}

public class Profile
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<string> Done { get; set; } = new();
    public List<Grade> Grades { get; set; } = new();
    public Prefs Prefs { get; set; } = new();
    public Dictionary<string, int>? Levels { get; set; }
}

public static class Data
{
    public static readonly (string Id, string Label, string Glyph)[] Kinds =
    {
        ("eval", "Évaluation", ""), ("examen", "Examen blanc", ""), ("devoir", "Devoir", ""),
        ("exercice", "Exercice", ""), ("cours", "Cours", ""), ("revision", "Révision", ""), ("autre", "Autre", ""),
    };
    public static readonly HashSet<string> Deadline = new() { "eval", "examen", "devoir", "exercice" };
    public static string KindLabel(string k) => Kinds.FirstOrDefault(x => x.Id == k).Label ?? "Évaluation";
    public static string KindGlyph(string k) => Kinds.FirstOrDefault(x => x.Id == k).Glyph ?? "";

    public static readonly (string Id, string Label)[] Slots = { ("cours", "Fiche de cours"), ("sujet", "Sujet type"), ("corrige", "Corrigé"), ("topexo", "TOP EXO") };
    public static readonly (string Id, string Label)[] Categories = { ("controle", "Contrôle UFA"), ("devoir", "Devoir"), ("examen", "Examen blanc"), ("entrainement", "Entraînement") };
    public static readonly string[] Subjects =
    {
        "UE1 · Fondamentaux du droit", "UE2 · Droit des sociétés", "UE3 · Droit social", "UE4 · Droit fiscal",
        "UE5 · Économie contemporaine", "UE6 · Finance d'entreprise", "UE7 · Management", "UE8 · Systèmes d'information de gestion",
        "UE9 · Introduction à la comptabilité", "UE10 · Comptabilité approfondie", "UE11 · Contrôle de gestion",
        "UE12 · Anglais appliqué aux affaires", "UE13 · Communication professionnelle",
    };
    public static readonly string[] ColorNames = { "red", "orange", "yellow", "green", "blue", "purple", "brown" };
    public static string ColorHex(string? c) => c switch
    {
        "red" => "#FF3B30", "orange" => "#FF9500", "yellow" => "#FFCC00", "green" => "#34C759",
        "purple" => "#AF52DE", "brown" => "#A2845E", _ => "#007AFF",
    };

    public static readonly CultureInfo Fr = new("fr-FR");
    public static string Iso(DateTime d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    public static DateTime Parse(string s) => DateTime.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : DateTime.Today;
    public static DateTime Monday(DateTime d) => d.Date.AddDays(-(((int)d.DayOfWeek + 6) % 7));
    public static string LongDate(string s) => Parse(s).ToString("dddd d MMMM", Fr);
    public static string Cap(string s) => s.Length == 0 ? s : char.ToUpper(s[0]) + s[1..];
    public static string Num(double n, int digits = 1) => Math.Round(n, digits).ToString("0.##", Fr);
    public static string Size(long n) => n > 1048576 ? $"{Num(n / 1048576.0)} Mo" : $"{Math.Max(1, n / 1024)} Ko";

    public static string Relative(string s)
    {
        var n = (Parse(s) - DateTime.Today).Days;
        return n switch { 0 => "Aujourd'hui", 1 => "Demain", -1 => "Hier", >= 2 and <= 6 => $"Dans {n} jours", _ => Cap(LongDate(s)) };
    }

    static readonly Dictionary<int, Dictionary<string, string>> holidayCache = new();
    public static string? Holiday(string date)
    {
        var year = int.Parse(date[..4]);
        if (!holidayCache.TryGetValue(year, out var list))
        {
            int a = year % 19, b = year / 100, c = year % 100, d = b / 4, e = b % 4, f = (b + 8) / 25, g = (b - f + 1) / 3;
            int h = (19 * a + b - d - g + 15) % 30, i = c / 4, k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = (a + 11 * h + 22 * l) / 451;
            var easter = new DateTime(year, (h + l - 7 * m + 114) / 31, (h + l - 7 * m + 114) % 31 + 1);
            list = new()
            {
                [$"{year}-01-01"] = "Jour de l'an", [Iso(easter.AddDays(1))] = "Lundi de Pâques", [$"{year}-05-01"] = "Fête du Travail",
                [$"{year}-05-08"] = "Victoire 1945", [Iso(easter.AddDays(39))] = "Ascension", [Iso(easter.AddDays(50))] = "Lundi de Pentecôte",
                [$"{year}-07-14"] = "Fête nationale", [$"{year}-08-15"] = "Assomption", [$"{year}-11-01"] = "Toussaint",
                [$"{year}-11-11"] = "Armistice 1918", [$"{year}-12-25"] = "Noël",
            };
            holidayCache[year] = list;
        }
        return list.TryGetValue(date, out var name) ? name : null;
    }

    public static double? Average(IEnumerable<Grade> list)
    {
        var c = list.Where(g => g.Category != "entrainement").ToList();
        var coefs = c.Sum(g => g.Coef);
        return coefs > 0 ? c.Sum(g => g.On20 * g.Coef) / coefs : null;
    }
}

public class ApiException(string message, int status) : Exception(message) { public int Status { get; } = status; }

public static class Api
{
    public static readonly Uri Revise = new("https://objectif-dcg.netlify.app/");
    public static readonly Uri Site = new(Environment.GetEnvironmentVariable("AGENDA_SITE") ?? "https://agendadcg.netlify.app");
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
    static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AgendaDCG");
    static readonly string CookieFile = Path.Combine(Dir, "session.json");
    static Dictionary<string, string> cookies = Load();
    public static readonly HttpClient Http = new(new HttpClientHandler { UseCookies = false, AllowAutoRedirect = true }) { Timeout = TimeSpan.FromSeconds(60) };

    static Api() { Http.DefaultRequestHeaders.UserAgent.ParseAdd($"AgendaDCG-Windows/{typeof(Api).Assembly.GetName().Version?.ToString(3) ?? "dev"}"); }

    static Dictionary<string, string> Load()
    {
        try { return JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(CookieFile)) ?? new(); } catch { return new(); }
    }
    static void Save() { Directory.CreateDirectory(Dir); File.WriteAllText(CookieFile, JsonSerializer.Serialize(cookies)); }
    public static void ClearSession() { cookies.Clear(); Save(); }

    public static HttpRequestMessage Request(HttpMethod method, string path, object? body = null)
    {
        var req = new HttpRequestMessage(method, new Uri(Site, "api/" + path));
        if (cookies.Count > 0) req.Headers.Add("Cookie", string.Join("; ", cookies.Select(c => $"{c.Key}={c.Value}")));
        if (body != null) req.Content = JsonContent.Create(body, body.GetType(), options: Json);
        return req;
    }

    static void Store(HttpResponseMessage res)
    {
        if (res.RequestMessage?.RequestUri?.Host != Site.Host || !res.Headers.TryGetValues("Set-Cookie", out var lines)) return;
        foreach (var line in lines)
        {
            var kv = line.Split(';')[0].Split('=', 2);
            if (kv.Length < 1 || (kv[0] != "agenda_session" && kv[0] != "agenda_profile")) continue;
            var value = kv.Length > 1 ? kv[1] : "";
            if (value == "" || line.Contains("Max-Age=0")) cookies.Remove(kv[0]); else cookies[kv[0]] = value;
        }
        Save();
    }

    public static async Task<(string Body, int Status)> Raw(HttpMethod method, string path, object? body = null)
    {
        using var res = await Http.SendAsync(Request(method, path, body));
        Store(res);
        return (await res.Content.ReadAsStringAsync(), (int)res.StatusCode);
    }

    public static async Task<T> Call<T>(HttpMethod method, string path, object? body = null)
    {
        var (text, status) = await Raw(method, path, body);
        if (status < 200 || status >= 300)
        {
            string? msg = null;
            try { msg = JsonDocument.Parse(text).RootElement.GetProperty("error").GetString(); } catch { }
            throw new ApiException(msg ?? $"Erreur {status}", status);
        }
        return JsonSerializer.Deserialize<T>(text, Json)!;
    }

    public static Task<T> Get<T>(string path) => Call<T>(HttpMethod.Get, path);
    public static string Q(string s) => Uri.EscapeDataString(s);
}

/// État partagé de l'app, rafraîchi toutes les 2 minutes.
public class Store
{
    public static readonly Store I = new();
    public List<AgendaEvent> Events = new();
    public List<Chapter> Chapters = new();
    public Profile? Profile;
    public Schedule? Schedule;
    public bool Offline;
    public event Action? Changed;

    public string Name => Profile?.Name ?? "";
    public bool IsDone(AgendaEvent e) => Profile?.Done.Contains(e.Id) ?? false;
    public Chapter? Chapter(string id) => Chapters.FirstOrDefault(c => c.Id == id);
    public List<AgendaEvent> On(string day) => (Schedule?.On(day) ?? new()).Concat(Events.Where(e => e.Date == day)).OrderBy(e => e.SortKey).ToList();
    public bool IsCompanyDay(string day) => Schedule?.IsCompanyDay(day) ?? false;
    public static bool SameSubject(string? a, string? b) => !string.IsNullOrEmpty(a) && !string.IsNullOrEmpty(b) && (a == b || a.Split(" · ")[0] == b.Split(" · ")[0]);
    /// Le cours de la matière ce jour-là : un devoir s'y range automatiquement.
    public AgendaEvent? ClassFor(string day, string? subject) => Schedule?.On(day).FirstOrDefault(c => SameSubject(c.Subject, subject));
    public List<AgendaEvent> NextClasses(string? subject, int n = 4)
    {
        var o = new List<AgendaEvent>();
        for (var i = 0; i < 120 && o.Count < n; i++) if (ClassFor(Data.Iso(DateTime.Today.AddDays(i)), subject) is { } c) o.Add(c);
        return o;
    }
    public bool InClass(AgendaEvent e)
    {
        return !e.IsClass && ClassFor(e.Date, e.Subject) != null;
    }
    public List<AgendaEvent> PastHomework() { var t = Data.Iso(DateTime.Today); return Events.Where(e => string.CompareOrdinal(e.Date, t) < 0 && (e.Attachments?.Count ?? 0) > 0).OrderByDescending(e => e.Date).ToList(); }

    /// Joint un PDF à un devoir (rangé avec le devoir, pas dans les cours).
    public async Task Attach(string path, AgendaEvent ev)
    {
        var data = await File.ReadAllBytesAsync(path);
        if (data.Length > 100 * 1024 * 1024) throw new ApiException("PDF trop lourd (max 100 Mo)", 413);
        var name = Path.GetFileName(path);
        var s = await Api.Call<Start>(HttpMethod.Post, "files/start", new { @event = ev.Id, by = Name, name, size = data.Length });
        using var put = new HttpRequestMessage(HttpMethod.Put, s.UploadUrl) { Content = new ByteArrayContent(data) };
        put.Content.Headers.ContentType = new("application/pdf");
        using var res = await Api.Http.SendAsync(put);
        if (!res.IsSuccessStatusCode) throw new ApiException("Envoi impossible", (int)res.StatusCode);
        var updated = await Api.Call<AgendaEvent>(HttpMethod.Post, "files/finish", new { @event = ev.Id, key = s.Key, name, by = Name });
        Events.RemoveAll(e => e.Id == updated.Id);
        Events.Add(updated);
        Notify();
    }
    public List<string> CourseSubjects()
    {
        var have = Chapters.Select(c => c.Subject).ToHashSet();
        return Data.Subjects.Where(have.Contains).Concat(have.Except(Data.Subjects).OrderBy(s => s)).ToList();
    }
    public void Notify() => Changed?.Invoke();

    public async Task Refresh()
    {
        try
        {
            var ev = await Api.Get<List<AgendaEvent>>("events");
            var ch = await Api.Get<List<Chapter>>("chapters");
            try { Schedule = JsonSerializer.Deserialize<Schedule>(await Api.Http.GetStringAsync(new Uri(Api.Site, "schedule.json")), Api.Json); } catch { }
            var previous = Events.Select(e => e.Id).ToHashSet();
            var first = Events.Count == 0;
            Events = ev;
            Chapters = ch.OrderBy(c => c.Title, StringComparer.Create(Data.Fr, CompareOptions.IgnoreCase)).ToList();
            try { Profile = await Api.Get<Profile>("profile"); } catch { }
            Offline = false;
            if (!first && Profile?.Prefs.OnNew == true)
                foreach (var n in ev.Where(e => !previous.Contains(e.Id) && e.IsDeadline && e.CreatedBy != Name))
                    Notifier.Now($"Nouveau : {Data.KindLabel(n.Kind).ToLower()}", $"{n.Title} · {Data.LongDate(n.Date)}");
            Notifier.Schedule(Events, Profile);
        }
        catch (ApiException e) when (e.Status == 401) { throw; }
        catch { Offline = true; }
        Notify();
    }

    public async Task Save(AgendaEvent ev, bool isNew)
    {
        var body = new Dictionary<string, object?>
        {
            ["kind"] = ev.Kind, ["title"] = ev.Title, ["subject"] = ev.Subject ?? "", ["date"] = ev.Date, ["time"] = ev.Time ?? "",
            ["color"] = ev.Color ?? "blue", ["notes"] = ev.Notes ?? "", ["chapters"] = ev.Chapters ?? new(), ["by"] = Name,
        };
        var saved = await Api.Call<AgendaEvent>(isNew ? HttpMethod.Post : HttpMethod.Put, isNew ? "events" : $"events/{ev.Id}", body);
        Events.RemoveAll(e => e.Id == saved.Id);
        Events.Add(saved);
        Notify();
    }

    public async Task Delete(AgendaEvent ev)
    {
        await Api.Call<JsonElement>(HttpMethod.Delete, $"events/{ev.Id}?by={Api.Q(Name)}");
        Events.RemoveAll(e => e.Id == ev.Id);
        Notify();
    }

    public async Task ToggleDone(AgendaEvent ev)
    {
        var done = !IsDone(ev);
        Profile = await Api.Call<Profile>(HttpMethod.Put, "profile/done", new { @event = ev.Id, done });
        Notifier.Schedule(Events, Profile);
        Notify();
    }

    // Révisions personnalisées (niveau 1–10 par matière, comme sur le site)
    public record RevisionPick(string Subject, Chapter? Chapter, string Why, double Score)
    {
        public string Label => $"{Subject.Split(" · ")[0]} · {Chapter?.Title ?? "reprendre le cours"}";
    }
    public List<string> RevSubjects() => (Schedule?.Classes ?? new()).Where(c => c.Kind != "revision").Select(c => c.Subject).Distinct().ToList();
    public bool HasLevels => Profile?.Levels?.Keys.Any(k => k != "__mode") ?? false;
    public int? LevelOf(string s) { var l = Profile?.Levels; if (l == null) return null; foreach (var kv in l) if (SameSubject(kv.Key, s)) return kv.Value; return null; }
    public static string LevelWord(int n) => n <= 3 ? "à reprendre" : n <= 5 ? "fragile" : n <= 7 ? "correct" : "solide";
    static DateTime Saturday(string day) { var d = Data.Parse(day); var wd = (int)d.DayOfWeek; return d.AddDays(wd == 0 ? -1 : 6 - wd); }
    public List<RevisionPick> RevisionPicks(string day)
    {
        var satD = Saturday(day); var sat = Data.Iso(satD);
        var weekN = (int)Math.Floor((satD - new DateTime(1970, 1, 1)).TotalDays / 7);
        var items = new List<RevisionPick>(); var seen = new HashSet<string>();
        var deadlines = Events.Where(e => new[] { "eval", "examen", "devoir", "exercice" }.Contains(e.Kind) && string.CompareOrdinal(e.Date, sat) > 0 && !IsDone(e)).ToList();
        foreach (var s in RevSubjects())
        {
            var lvl = LevelOf(s) ?? 5; var weak = (11 - lvl) / 10.0;
            var chs = Chapters.Where(c => SameSubject(c.Subject, s)).OrderBy(c => System.Text.RegularExpressions.Regex.Replace(c.Title, @"\d+", m => m.Value.PadLeft(5, (char)48))).ToList();
            foreach (var e in deadlines.Where(x => SameSubject(x.Subject, s)))
            {
                var days = (Data.Parse(e.Date) - satD).Days; if (days > 14) continue;
                var linked = (e.Chapters ?? new()).Select(Chapter).Where(c => c != null).ToList();
                foreach (var ch in linked.Count > 0 ? linked : new List<Chapter?> { null })
                {
                    var id = ch?.Id ?? $"s:{s}{e.Id}"; if (!seen.Add(id)) continue;
                    items.Add(new(s, ch, $"{Data.KindLabel(e.Kind)} dans {days} jour{(days > 1 ? "s" : "")}", 4 + 3 * (1 - days / 14.0) + 2 * weak));
                }
            }
            var n = lvl <= 3 ? 3 : lvl <= 6 ? 2 : 1;
            for (var i = 0; i < n; i++)
            {
                var ch = chs.Count > 0 ? chs[(weekN * n + i) % chs.Count] : null;
                var id = ch?.Id ?? $"s:{s}{i}"; if ((ch == null && i > 0) || !seen.Add(id)) continue;
                items.Add(new(s, ch, $"Niveau {lvl}/10 · {LevelWord(lvl)}", 3 * weak - i * 0.3));
            }
        }
        return items.OrderByDescending(x => x.Score).ToList();
    }
    /// Méthode : "sujets" (révision le matin, sujets des mêmes chapitres le soir) ou "revision" (révision seule).
    public string AdvisedMode { get { var ls = RevSubjects().Select(s => (double)(LevelOf(s) ?? 5)).ToList(); return (ls.Count == 0 ? 5 : ls.Average()) < 5 ? "revision" : "sujets"; } }
    public string RevMode => (Profile?.Levels != null && Profile.Levels.TryGetValue("__mode", out var m)) ? (m == 2 ? "sujets" : "revision") : AdvisedMode;
    (int day, int part) RevSlot(AgendaEvent e)
    {
        var same = (Schedule?.On(e.Date) ?? new()).Where(x => x.Revision).ToList();
        return (Data.Parse(e.Date).DayOfWeek == DayOfWeek.Sunday ? 1 : 0, Math.Max(0, same.FindIndex(x => x.Id == e.Id)));
    }
    public bool IsSujetSlot(AgendaEvent e) => e.Revision && RevMode == "sujets" && RevSlot(e).part == 1;
    public string RevTitle(AgendaEvent e) => !e.Revision ? e.Title : IsSujetSlot(e) ? "Sujets d'entraînement" : "Révision des chapitres";
    public List<RevisionPick> RevisionFor(AgendaEvent e)
    {
        if (!e.Revision || !HasLevels) return new();
        var all = RevisionPicks(e.Date);
        if (RevMode == "sujets") all = all.Where(p => p.Chapter?.Files.GetValueOrDefault("sujet") != null).Concat(all.Where(p => p.Chapter?.Files.GetValueOrDefault("sujet") == null)).ToList();
        var s = RevSlot(e); var block = RevMode == "sujets" ? s.day : s.day * 2 + s.part;
        return all.Skip(block * 2).Take(2).ToList();
    }
    public async Task SaveLevels(Dictionary<string, int> levels)
    {
        Profile = await Api.Call<Profile>(HttpMethod.Put, "profile/levels", new { levels });
        Notify();
    }

    public async Task SavePrefs(Prefs prefs)
    {
        Profile = await Api.Call<Profile>(HttpMethod.Put, "profile/prefs", new { prefs });
        Notifier.Schedule(Events, Profile);
        Notify();
    }

    public async Task SaveChapter(string? id, string subject, string title)
    {
        var ch = await Api.Call<Chapter>(id == null ? HttpMethod.Post : HttpMethod.Put, id == null ? "chapters" : $"chapters/{id}", new { subject, title, by = Name });
        Chapters.RemoveAll(c => c.Id == ch.Id);
        Chapters.Add(ch);
        Notify();
    }

    public async Task DeleteChapter(Chapter ch)
    {
        await Api.Call<JsonElement>(HttpMethod.Delete, $"chapters/{ch.Id}?by={Api.Q(Name)}");
        await Refresh();
    }

    record Start(string Key, string UploadUrl);

    public async Task Upload(string path, Chapter chapter, string slot)
    {
        var data = await File.ReadAllBytesAsync(path);
        if (data.Length > 100 * 1024 * 1024) throw new ApiException("PDF trop lourd (max 100 Mo)", 413);
        var name = Path.GetFileName(path);
        var s = await Api.Call<Start>(HttpMethod.Post, "files/start", new { chapter = chapter.Id, slot, by = Name, name, size = data.Length });
        using var put = new HttpRequestMessage(HttpMethod.Put, s.UploadUrl) { Content = new ByteArrayContent(data) };
        put.Content.Headers.ContentType = new("application/pdf");
        using var res = await Api.Http.SendAsync(put);
        if (!res.IsSuccessStatusCode) throw new ApiException("Envoi du PDF impossible", (int)res.StatusCode);
        var ch = await Api.Call<Chapter>(HttpMethod.Post, "files/finish", new { chapter = chapter.Id, slot, key = s.Key, name, by = Name });
        Chapters.RemoveAll(c => c.Id == ch.Id);
        Chapters.Add(ch);
        Notify();
    }

    public async Task DeleteFile(PdfFile f, Chapter chapter, string slot)
    {
        var ch = await Api.Call<Chapter>(HttpMethod.Delete, $"files/{f.Key}?chapter={chapter.Id}&slot={slot}&by={Api.Q(Name)}");
        Chapters.RemoveAll(c => c.Id == ch.Id);
        Chapters.Add(ch);
        Notify();
    }

    public async Task<string> Download(PdfFile f)
    {
        using var res = await Api.Http.SendAsync(Api.Request(HttpMethod.Get, $"files/{f.Key}"));
        if (!res.IsSuccessStatusCode) throw new ApiException("PDF indisponible", (int)res.StatusCode);
        var dir = Path.Combine(Path.GetTempPath(), "AgendaDCG", f.Key);
        Directory.CreateDirectory(dir);
        var dest = Path.Combine(dir, string.Join("_", f.Name.Split(Path.GetInvalidFileNameChars())));
        await File.WriteAllBytesAsync(dest, await res.Content.ReadAsByteArrayAsync());
        return dest;
    }
}
