using Microsoft.Toolkit.Uwp.Notifications;
using Velopack;
using Velopack.Sources;
using Windows.UI.Notifications;

namespace AgendaDCG;

/// Rappels Windows (notifications programmées : elles s'affichent même app fermée).
public static class Notifier
{
    public static void Now(string title, string body)
    {
        try { new ToastContentBuilder().AddText(title).AddText(body).Show(); } catch { }
    }

    public static void Schedule(List<AgendaEvent> events, Profile? profile)
    {
        try
        {
            var notifier = ToastNotificationManagerCompat.CreateToastNotifier();
            foreach (var t in notifier.GetScheduledToastNotifications()) notifier.RemoveFromSchedule(t);
            if (profile == null) return;
            var prefs = profile.Prefs;
            var today = Data.Iso(DateTime.Today);
            var todo = events.Where(e => e.IsDeadline && !profile.Done.Contains(e.Id) && string.CompareOrdinal(e.Date, today) >= 0).ToList();

            void Add(string id, DateTime day, int hour, string title, string body)
            {
                var when = day.Date.AddHours(hour);
                if (when <= DateTime.Now.AddSeconds(30)) return;
                var xml = new ToastContentBuilder().AddText(title).AddText(body).GetXml();
                notifier.AddToSchedule(new ScheduledToastNotification(xml, when) { Tag = id.Length > 64 ? id[..64] : id, Group = "agenda" });
            }

            if (prefs.Daily)
                for (var i = 0; i < 14; i++)
                {
                    var day = DateTime.Today.AddDays(i);
                    var list = events.Where(e => e.Date == Data.Iso(day)).OrderBy(e => e.SortKey).ToList();
                    if (list.Count > 0) Add($"d{i}", day, 7, "Aujourd'hui", string.Join(" · ", list.Select(e => (string.IsNullOrEmpty(e.Time) ? "" : e.Time + " ") + e.Title)));
                }
            foreach (var d in prefs.Before)
                foreach (var e in todo)
                    Add($"b{d}-{e.Id}", Data.Parse(e.Date).AddDays(-d), 19, d == 1 ? "Demain" : $"Dans {d} jours", $"{Data.KindLabel(e.Kind)} : {e.Title}");
            if (prefs.Weekly)
                for (var w = 0; w < 4; w++)
                {
                    var sunday = Data.Monday(DateTime.Today).AddDays(6 + 7 * w);
                    var from = Data.Iso(sunday.AddDays(1)); var to = Data.Iso(sunday.AddDays(7));
                    var n = todo.Count(e => string.CompareOrdinal(e.Date, from) >= 0 && string.CompareOrdinal(e.Date, to) <= 0);
                    Add($"w{w}", sunday, 18, "Ta semaine", n == 0 ? "Rien à rendre la semaine prochaine." : $"{n} échéance{(n > 1 ? "s" : "")} la semaine prochaine.");
                }
        }
        catch { }
    }
}

/// Mises à jour automatiques via Velopack + releases GitHub.
public static class Updater
{
    static readonly UpdateManager mgr = new(new GithubSource("https://github.com/Tauwni/AgendaDCG", null, false));
    static UpdateInfo? pending;
    public static string Status { get; private set; } = "À jour";
    public static bool Ready => pending != null;
    public static event Action? Changed;
    public static string Version => mgr.IsInstalled ? mgr.CurrentVersion?.ToString() ?? "?" : "développement";

    public static async Task Loop()
    {
        await Task.Delay(5000);
        while (true)
        {
            await Check();
            await Task.Delay(TimeSpan.FromHours(6));
        }
    }

    public static async Task Check()
    {
        if (!mgr.IsInstalled) { Status = "Désactivée (version de développement)"; Changed?.Invoke(); return; }
        if (pending != null) return;
        try
        {
            Status = "Recherche…"; Changed?.Invoke();
            var info = await mgr.CheckForUpdatesAsync();
            if (info == null) { Status = $"À jour ({Version})"; Changed?.Invoke(); return; }
            Status = $"Téléchargement de la version {info.TargetFullRelease.Version}…"; Changed?.Invoke();
            await mgr.DownloadUpdatesAsync(info);
            pending = info;
            Status = $"Version {info.TargetFullRelease.Version} prête : redémarre pour l'installer";
        }
        catch { Status = "Impossible de vérifier (hors ligne ?)"; }
        Changed?.Invoke();
    }

    public static void ApplyAndRestart()
    {
        var p = pending; pending = null;
        if (p != null) mgr.ApplyUpdatesAndRestart(p.TargetFullRelease);
    }

    /// Appelé à la fermeture : installe la mise à jour téléchargée sans relancer.
    public static void ApplyOnExit()
    {
        var p = pending; pending = null;
        if (p != null) try { mgr.WaitExitThenApplyUpdates(p.TargetFullRelease, silent: true, restart: false); } catch { }
    }
}
