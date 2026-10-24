/** One primary pointer owns a scrub; rerenders must not reset its session. */
export class PointerScrubSession {
  private pointer: number | null = null;
  private value: string | null = null;

  begin(pointerId: number, primary: boolean, button: number): boolean {
    if (!primary || button !== 0 || this.pointer !== null) return false;
    this.pointer = pointerId;
    this.value = null;
    return true;
  }

  select(pointerId: number, value: string): boolean {
    if (this.pointer !== pointerId || this.value === value) return false;
    this.value = value;
    return true;
  }

  owns(pointerId: number): boolean { return this.pointer === pointerId; }

  end(pointerId: number): void {
    if (!this.owns(pointerId)) return;
    this.pointer = null;
    this.value = null;
  }
}
