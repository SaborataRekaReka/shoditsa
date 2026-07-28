using System;
using System.Diagnostics;
using System.IO;
using System.Linq;

public static class SofficeWordShim
{
    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    public static int Main(string[] args)
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(baseDir, "soffice-word.ps1");
        string forwarded = string.Join(" ", args.Select(Quote));

        var start = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + Quote(script) + " " + forwarded,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        using (var process = Process.Start(start))
        {
            Console.Out.Write(process.StandardOutput.ReadToEnd());
            Console.Error.Write(process.StandardError.ReadToEnd());
            process.WaitForExit();
            return process.ExitCode;
        }
    }
}
