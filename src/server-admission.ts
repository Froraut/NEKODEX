/** Listener admission: draining is reversible, but committed shutdown never is. */
export class ServerAdmission {
  private state: "running" | "draining" | "shutting-down" = "running";

  get accepting(): boolean { return this.state === "running"; }
  get draining(): boolean { return !this.accepting; }

  drain(): void {
    if (this.state === "running") this.state = "draining";
  }

  resume(): boolean {
    if (this.state === "shutting-down") return false;
    this.state = "running";
    return true;
  }

  beginShutdown(): void { this.state = "shutting-down"; }
}
