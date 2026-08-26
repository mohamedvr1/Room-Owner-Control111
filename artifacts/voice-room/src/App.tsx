import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SocketProvider } from "@/context/SocketContext";
import NotFound from "@/pages/not-found";
import JoinPage  from "@/pages/JoinPage";
import LobbyPage from "@/pages/LobbyPage";
import RoomPage  from "@/pages/RoomPage";
import StorePage from "@/pages/StorePage";
import UnlockPage from "@/pages/UnlockPage";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/"      component={JoinPage}  />
      <Route path="/lobby" component={LobbyPage} />
      <Route path="/room"  component={RoomPage}  />
      <Route path="/store" component={StorePage} />
      <Route path="/unlock" component={UnlockPage} />
      <Route component={NotFound} />
    </Switch>
  );
}


export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <SocketProvider>
            <Router />
          </SocketProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
