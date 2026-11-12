"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadAvatarImage = uploadAvatarImage;
exports.uploadAttachment = uploadAttachment;
exports.destroyAssets = destroyAssets;
const cloudinary_1 = require("../config/cloudinary");
const httpError_1 = require("../middleware/httpError");
async function uploadAvatarImage(buffer, userId) {
    if (!cloudinary_1.isCloudinaryConfigured)
        throw new httpError_1.HttpError(503, 'Image storage is not configured');
    return new Promise((resolve, reject) => {
        cloudinary_1.cloudinary.uploader
            .upload_stream({
            folder: 'chat-app/avatars',
            public_id: userId, // نفس المعرّف: الصورة الجديدة تستبدل القديمة تلقائياً
            overwrite: true,
            invalidate: true,
            resource_type: 'image',
            transformation: [
                { width: 512, height: 512, crop: 'fill', gravity: 'auto' },
            ],
        }, (err, result) => (err || !result ? reject(err) : resolve(result)))
            .end(buffer);
    });
}
async function uploadAttachment(buffer, d, id) {
    if (!cloudinary_1.isCloudinaryConfigured)
        throw new httpError_1.HttpError(503, 'File storage is not configured');
    return new Promise((resolve, reject) => {
        cloudinary_1.cloudinary.uploader
            .upload_stream({
            folder: 'chat-app/attachments',
            // الملفات غير الصور (raw) تحتاج الامتداد داخل public_id
            public_id: d.kind === 'image' ? id : `${id}.${d.ext}`,
            resource_type: d.kind === 'image' ? 'image' : 'raw',
            unique_filename: false,
            use_filename: false,
        }, (err, result) => (err || !result ? reject(err) : resolve(result)))
            .end(buffer);
    });
}
/** حذف أفضل جهد: فشله لا يوقف العملية */
async function destroyAssets(assets) {
    if (!cloudinary_1.isCloudinaryConfigured)
        return;
    await Promise.allSettled(assets
        .filter((a) => a.publicId)
        .map((a) => cloudinary_1.cloudinary.uploader.destroy(a.publicId, {
        resource_type: a.mimeType.startsWith('image/') ? 'image' : 'raw',
        invalidate: true,
    })));
}
