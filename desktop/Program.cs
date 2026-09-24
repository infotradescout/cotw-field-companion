using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace GrindZone.Desktop;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--version")
        {
            Console.WriteLine(typeof(Program).Assembly.GetName().Version);
            return 0;
        }

        if (!TryReadArguments(args, out var localUrl, out var profile))
        {
            MessageBox.Show("GrindZone could not verify its local desktop launch. Open the installed GrindZone shortcut again.",
                "GrindZone", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new GrindZoneWindow(localUrl!, profile!));
        return 0;
    }

    private static bool TryReadArguments(string[] args, out Uri? localUrl, out string? profile)
    {
        localUrl = null;
        profile = null;
        if (args.Length != 4 || args[0] != "--url" || args[2] != "--profile") return false;
        if (!Uri.TryCreate(args[1], UriKind.Absolute, out var parsed) ||
            parsed.Scheme != Uri.UriSchemeHttp || parsed.Host != "127.0.0.1" ||
            parsed.Port < 1024 || parsed.Port > 65535 || parsed.AbsolutePath != "/" ||
            !string.IsNullOrEmpty(parsed.Query) || !string.IsNullOrEmpty(parsed.Fragment) ||
            !string.IsNullOrEmpty(parsed.UserInfo)) return false;
        if (!Path.IsPathRooted(args[3])) return false;
        localUrl = parsed;
        profile = Path.GetFullPath(args[3]);
        return true;
    }
}

internal sealed class GrindZoneWindow : Form
{
    private readonly Uri localUrl;
    private readonly string profile;
    private readonly WebView2 view = new() { Dock = DockStyle.Fill };

    internal GrindZoneWindow(Uri localUrl, string profile)
    {
        this.localUrl = localUrl;
        this.profile = profile;
        Text = "GrindZone";
        Width = 1280;
        Height = 850;
        MinimumSize = new Size(800, 560);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(view);
        Shown += async (_, _) => await OpenAsync();
        _ = Task.Run(ReadOwnerCommands);
    }

    private void ReadOwnerCommands()
    {
        string? command;
        while ((command = Console.ReadLine()) != null)
        {
            if (command != "close") continue;
            if (IsHandleCreated && !IsDisposed) BeginInvoke(Close);
            break;
        }
    }

    private async Task OpenAsync()
    {
        try
        {
            Directory.CreateDirectory(profile);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile);
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (IsLocalNavigation(e.Uri)) return;
                e.Cancel = true;
                OpenExternalLink(e.Uri);
            };
            view.CoreWebView2.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                OpenExternalLink(e.Uri);
            };
            view.Source = localUrl;
        }
        catch (Exception error)
        {
            MessageBox.Show("GrindZone could not open its desktop window. " + error.Message,
                "GrindZone", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private bool IsLocalNavigation(string address)
    {
        return Uri.TryCreate(address, UriKind.Absolute, out var target) &&
            target.Scheme == Uri.UriSchemeHttp && target.Host == "127.0.0.1" &&
            target.Port == localUrl.Port && string.IsNullOrEmpty(target.UserInfo);
    }

    private static void OpenExternalLink(string address)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var target) ||
            target.Scheme != Uri.UriSchemeHttps) return;
        try { Process.Start(new ProcessStartInfo(target.AbsoluteUri) { UseShellExecute = true }); }
        catch { /* The application remains usable when an external link cannot open. */ }
    }
}
