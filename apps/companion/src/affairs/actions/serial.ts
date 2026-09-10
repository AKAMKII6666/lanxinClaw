/** 同一事务的业务操作依次执行；不同事务及 heartbeat 不互相等待。 */
export class AffairOperationQueue {
  private readonly tails = new Map<string, Promise<void>>();

  /** 异常不会毒化后续操作；完成后释放队列条目。 */
  run<T>(affairId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(affairId) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(affairId, tail);
    void tail.then(() => {
      if (this.tails.get(affairId) === tail) this.tails.delete(affairId);
    });
    return result;
  }
}
