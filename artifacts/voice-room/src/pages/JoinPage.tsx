import { useState } from "react";
import { useSocket } from "@/context/SocketContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Ghost } from "lucide-react";

export default function JoinPage() {
  const { joinRoom, isConnected } = useSocket();
  const [name, setName] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [ownerSecret, setOwnerSecret] = useState("");

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    joinRoom(name, isOwner, ownerSecret);
  };

  return (
    <div className="min-h-dvh w-full flex items-center justify-center p-4 bg-background relative overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-20 pointer-events-none" />

      <div className="w-full max-w-md bg-card/80 backdrop-blur-xl border border-border rounded-xl p-8 shadow-2xl relative z-10">
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-4 shadow-[0_0_15px_rgba(255,0,0,0.3)]">
            <Ghost className="w-8 h-8 text-primary animate-pulse" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground font-mono">GhostRoom</h1>
          <p className="text-muted-foreground mt-2 text-sm">Enter if you dare.</p>
        </div>

        <form onSubmit={handleJoin} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-foreground/80">Your Name</Label>
            <Input 
              id="name" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              placeholder="e.g. Victim #1"
              required
              className="bg-background border-border/50 focus:border-primary"
              data-testid="input-name"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
            <Label htmlFor="isOwner" className="cursor-pointer text-foreground/80">I am the Owner</Label>
            <Switch 
              id="isOwner" 
              checked={isOwner} 
              onCheckedChange={setIsOwner}
              data-testid="switch-owner"
            />
          </div>

          {isOwner && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
              <Label htmlFor="secret" className="text-foreground/80">Owner Secret</Label>
              <Input 
                id="secret" 
                type="password"
                value={ownerSecret} 
                onChange={e => setOwnerSecret(e.target.value)} 
                placeholder="Password"
                required={isOwner}
                className="bg-background border-border/50 focus:border-accent"
                data-testid="input-ownersecret"
              />
            </div>
          )}

          <Button 
            type="submit" 
            className="w-full h-12 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_10px_rgba(255,0,0,0.2)] hover:shadow-[0_0_20px_rgba(255,0,0,0.4)] transition-all"
            disabled={!isConnected || !name.trim()}
            data-testid="button-join"
          >
            {isConnected ? "Enter Room" : "Connecting..."}
          </Button>
        </form>
      </div>
    </div>
  );
}
