/**
 * NotificationTarget — stores a user's notification target (SessionContext snapshot)
 * for scheduled tasks to deliver messages to.
 */

import mongoose from "mongoose";

export interface INotificationTarget {
    publicId: string;
    userId: string;
    name: string;
    adapterName: string;
    createdAt: Date;
}

const schema = new mongoose.Schema<INotificationTarget>({
    publicId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    name: { type: String, required: true },
    adapterName: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() },
});

export const NotificationTargetModel = mongoose.model<INotificationTarget>(
    "NotificationTarget",
    schema,
    "notification_targets",
);
