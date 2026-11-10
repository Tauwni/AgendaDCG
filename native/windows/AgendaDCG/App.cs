using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;
using Velopack;

namespace AgendaDCG;

public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        VelopackApp.Build().Run();
        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        app.Exit += (_, _) => Updater.ApplyOnExit();
        app.DispatcherUnhandledException += (_, e) =>
        {
            MessageBox.Show(e.Exception.Message, "Agenda DCG", MessageBoxButton.OK, MessageBoxImage.Warning);
            e.Handled = true;
        };
        app.Run(new MainWindow());
    }
}

/// Couleurs et styles (clair / sombre selon Windows).
public static class Theme
{
    public static readonly bool Dark = IsDark();
    static bool IsDark()
    {
        try { return Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")?.GetValue("AppsUseLightTheme") is int v && v == 0; }
        catch { return false; }
    }
    static SolidColorBrush B(string hex) { var b = (SolidColorBrush)new BrushConverter().ConvertFromString(hex)!; b.Freeze(); return b; }
    public static readonly Brush Bg = B(Dark ? "#1C1C1E" : "#F5F5F7");
    public static readonly Brush Side = B(Dark ? "#161618" : "#EBEBF0");
    public static readonly Brush Card = B(Dark ? "#2C2C2E" : "#FFFFFF");
    public static readonly Brush Line = B(Dark ? "#3A3A3C" : "#E5E5EA");
    public static readonly Brush Text = B(Dark ? "#F5F5F7" : "#1D1D1F");
    public static readonly Brush Text2 = B(Dark ? "#A1A1A6" : "#6E6E73");
    public static readonly Brush Accent = B("#FF3B30");
    public static readonly Brush Blue = B(Dark ? "#0A84FF" : "#007AFF");
    public static readonly Brush Green = B("#34C759");
    public static readonly Brush Orange = B("#FF9500");
    public static readonly Brush Selected = B(Dark ? "#3A3A3C" : "#DCDCE2");
    public static Brush Of(string? color, byte alpha = 255)
    {
        var c = (Color)ColorConverter.ConvertFromString(Data.ColorHex(color));
        var b = new SolidColorBrush(Color.FromArgb(alpha, c.R, c.G, c.B)); b.Freeze(); return b;
    }
    public static readonly FontFamily Font = new("Segoe UI Variable Text, Segoe UI");
    public static readonly FontFamily Icons = new("Segoe Fluent Icons, Segoe MDL2 Assets");
}
