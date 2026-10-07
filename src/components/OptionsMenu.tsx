import { Link } from "react-router-dom";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor, Shield, Plus, Settings, Github, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REPO_URL } from "@/lib/constants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Header options menu: theme switcher plus secondary navigation (submit /
 * admin) and the source link, so the top bar stays uncluttered on mobile.
 */
export default function OptionsMenu() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground"
          aria-label="Options"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Appearance
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light" className="gap-2">
            <Sun className="h-4 w-4" /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className="gap-2">
            <Moon className="h-4 w-4" /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" className="gap-2">
            <Monitor className="h-4 w-4" /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/submit" className="gap-2">
            <Plus className="h-4 w-4" /> Submit a Deal
          </Link>
        </DropdownMenuItem>
        {/* /admin is gated at the edge by Cloudflare Access, so a visible link
            is safe — non-admins hit the login wall. */}
        <DropdownMenuItem asChild>
          <Link to="/admin" className="gap-2">
            <Shield className="h-4 w-4" /> Admin
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Open source · MIT
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="gap-2">
            <Github className="h-4 w-4" /> Source code
            <ArrowUpRight className="ml-auto h-3 w-3 text-muted-foreground" />
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
