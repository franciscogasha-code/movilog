import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { UpdateBanner } from "@/components/UpdateBanner";
import { Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export function AppLayout() {
  const { profile } = useAuth();
  const initials = profile?.full_name
    ?.split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "??";

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full overflow-x-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 max-w-full">
          <UpdateBanner />
          <header className="h-14 flex items-center border-b border-border bg-card/80 backdrop-blur-md px-3 sm:px-4 sticky top-0 z-30">
            <SidebarTrigger className="mr-2 sm:mr-4" />
            <div className="flex-1" />
            <div className="flex items-center gap-2 sm:gap-3">
              {profile && (
                <span className="text-xs text-muted-foreground hidden md:inline truncate max-w-[180px]">
                  {profile.full_name}
                </span>
              )}
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                {initials}
              </div>
            </div>
          </header>
          <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-x-hidden overflow-y-auto">
            <div className="max-w-full">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
