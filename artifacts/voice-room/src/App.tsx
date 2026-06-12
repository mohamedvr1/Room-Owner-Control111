import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SocketProvider } from "@/context/SocketContext";
import NotFound from "@/pages/not-found";
import JoinPage from "@/pages/JoinPage";
import RoomPage from "@/pages/RoomPage";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/"    component={JoinPage} />
      <Route path="/room" component={RoomPage} />
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
