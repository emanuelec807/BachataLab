package com.emanuelec807.bachatalab;

import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Runs numbered jobs on a few worker threads and hands the results to the calling thread strictly in order
 * (0, 1, 2, ...). The caller does all the accumulation, in the same order as a plain loop would, so the
 * result is the same as running the jobs one after the other; only the time changes.
 * At most workers + 1 results wait at any moment, so memory stays bounded.
 */
final class Par {
    interface Job<R> { R run(int worker, int index) throws Exception; }
    interface Sink<R> { void take(int index, R result) throws Exception; }

    static <R> void ordered(int count, int workers, Job<R> job, Sink<R> sink, Separator.Cancel cc) throws Exception {
        if (count <= 0) return;
        workers = Math.max(1, Math.min(workers, count));
        if (workers == 1) {   // no extra thread: exactly the old loop
            for (int k = 0; k < count; k++) {
                if (cc.cancelled()) throw new InterruptedException("cancelled");
                sink.take(k, job.run(0, k));
            }
            return;
        }
        final Object[] res = new Object[count];
        final Object lock = new Object();
        final Semaphore room = new Semaphore(workers + 1);
        final AtomicInteger next = new AtomicInteger();
        final AtomicReference<Throwable> err = new AtomicReference<>();
        final int nw = workers;
        Thread[] ts = new Thread[nw];
        int prio = Thread.currentThread().getPriority();
        for (int w = 0; w < nw; w++) {
            final int wi = w;
            ts[w] = new Thread(() -> {
                try {
                    while (true) {
                        room.acquire();
                        int k = next.getAndIncrement();
                        if (k >= count || err.get() != null || cc.cancelled()) { room.release(); return; }
                        Object r = job.run(wi, k);
                        synchronized (lock) { res[k] = r; lock.notifyAll(); }
                    }
                } catch (Throwable t) {
                    err.compareAndSet(null, t);
                    synchronized (lock) { lock.notifyAll(); }
                }
            }, "separator-" + w);
            ts[w].setPriority(prio);
            ts[w].start();
        }
        try {
            for (int k = 0; k < count; k++) {
                Object r;
                synchronized (lock) {
                    while ((r = res[k]) == null && err.get() == null) {
                        if (cc.cancelled()) { err.compareAndSet(null, new InterruptedException("cancelled")); break; }
                        lock.wait(200);
                    }
                    res[k] = null;
                }
                if (err.get() != null) break;
                @SuppressWarnings("unchecked") R rr = (R) r;
                sink.take(k, rr);
                room.release();
            }
        } catch (Throwable t) {
            err.compareAndSet(null, t);
        } finally {
            room.release(nw + 1);   // wake any worker waiting for room so it can see the error and stop
            for (Thread t : ts) t.join();
        }
        Throwable t = err.get();
        if (t instanceof Exception) throw (Exception) t;
        if (t != null) throw new RuntimeException(t);
    }
}
