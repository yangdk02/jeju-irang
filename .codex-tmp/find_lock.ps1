param([Parameter(Mandatory=$true)][string]$Path)

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class FileLockFinder {
    const int CCH_RM_SESSION_KEY = 32;
    const int CCH_RM_MAX_APP_NAME = 255;
    const int CCH_RM_MAX_SVC_NAME = 63;
    const int ERROR_MORE_DATA = 234;

    [StructLayout(LayoutKind.Sequential)]
    struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct RM_PROCESS_INFO {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)] public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)] public string strServiceShortName;
        public uint ApplicationType;
        public uint AppStatus;
        public uint TSSessionId;
        [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint handle, int flags, string key);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint handle, uint files, string[] fileNames, uint apps, IntPtr appArray, uint services, string[] serviceNames);
    [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint handle, out uint needed, ref uint count, [In, Out] RM_PROCESS_INFO[] affectedApps, ref uint rebootReasons);
    [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint handle);

    public static string[] Find(string path) {
        uint handle;
        string key = Guid.NewGuid().ToString("N").Substring(0, CCH_RM_SESSION_KEY);
        int result = RmStartSession(out handle, 0, key);
        if (result != 0) throw new Exception("RmStartSession=" + result);
        try {
            result = RmRegisterResources(handle, 1, new[] { path }, 0, IntPtr.Zero, 0, null);
            if (result != 0) throw new Exception("RmRegisterResources=" + result);
            uint needed = 0, count = 0, reboot = 0;
            result = RmGetList(handle, out needed, ref count, null, ref reboot);
            if (result == 0) return new string[0];
            if (result != ERROR_MORE_DATA) throw new Exception("RmGetList(size)=" + result);
            var info = new RM_PROCESS_INFO[needed];
            count = needed;
            result = RmGetList(handle, out needed, ref count, info, ref reboot);
            if (result != 0) throw new Exception("RmGetList(data)=" + result);
            var output = new List<string>();
            for (int i = 0; i < count; i++) {
                int pid = info[i].Process.dwProcessId;
                string name;
                try { name = Process.GetProcessById(pid).ProcessName; } catch { name = info[i].strAppName; }
                output.Add(pid + "\t" + name + "\t" + info[i].strAppName);
            }
            return output.ToArray();
        } finally { RmEndSession(handle); }
    }
}
'@

Add-Type -TypeDefinition $source
[FileLockFinder]::Find((Resolve-Path -LiteralPath $Path).Path)
