import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { staffGuard } from '@/server/guard';
import { uploadImage, deleteImage } from '@/lib/cloudinary';

// POST - Upload photos to a room type
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomTypeId: string }> }
) {
  try {
    const guard = await staffGuard('inventory.write', { roomTypeId: (await params).roomTypeId });
    if ('error' in guard) return guard.error;

    const { roomTypeId } = await params;

    // Check if room type exists
    const roomType = await prisma.roomType.findUnique({
      where: { id: roomTypeId },
    });

    if (!roomType) {
      return NextResponse.json(
        { error: 'Room type not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { images, setAsMain } = body; // images is an array of base64 strings

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: 'No images provided' },
        { status: 400 }
      );
    }

    const uploadedPhotos = [];

    // Get existing photos count to determine if first upload should be main
    const existingPhotosCount = await prisma.roomTypePhoto.count({
      where: { roomTypeId }
    });

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      
      // Upload to local storage
      const result = await uploadImage(image, `room-types/${roomTypeId}`);

      // Create photo record in database
      const photo = await prisma.roomTypePhoto.create({
        data: {
          roomTypeId,
          url: result.url,
          publicId: result.publicId,
          // Set as main if it's the first photo ever or if explicitly requested
          isMain: (existingPhotosCount === 0 && i === 0) || (setAsMain === i),
        },
      });

      uploadedPhotos.push(photo);
    }

    return NextResponse.json({
      message: `Successfully uploaded ${uploadedPhotos.length} photo(s)`,
      photos: uploadedPhotos,
    });
  } catch (error) {
    console.error('Error uploading photos:', error);
    return NextResponse.json(
      { error: 'Failed to upload photos' },
      { status: 500 }
    );
  }
}

// GET - Get all photos for a room type
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomTypeId: string }> }
) {
  try {
    const guard = await staffGuard(null, { roomTypeId: (await params).roomTypeId });
    if ('error' in guard) return guard.error;

    const { roomTypeId } = await params;

    const photos = await prisma.roomTypePhoto.findMany({
      where: { roomTypeId },
      orderBy: [
        { isMain: 'desc' },
        { createdAt: 'asc' }
      ],
    });

    return NextResponse.json(photos);
  } catch (error) {
    console.error('Error fetching photos:', error);
    return NextResponse.json(
      { error: 'Failed to fetch photos' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a photo
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ roomTypeId: string }> }
) {
  try {
    const guard = await staffGuard('inventory.write', { roomTypeId: (await params).roomTypeId });
    if ('error' in guard) return guard.error;

    const { roomTypeId } = await params;
    const { searchParams } = new URL(request.url);
    const photoId = searchParams.get('photoId');

    if (!photoId) {
      return NextResponse.json(
        { error: 'Photo ID is required' },
        { status: 400 }
      );
    }

    // Find the photo
    const photo = await prisma.roomTypePhoto.findUnique({
      where: { id: photoId },
    });

    if (!photo) {
      return NextResponse.json(
        { error: 'Photo not found' },
        { status: 404 }
      );
    }

    // Delete from local storage
    if (photo.publicId) {
      try {
        await deleteImage(photo.publicId);
      } catch (error) {
        console.error('Error deleting from storage:', error);
        // Continue to delete from database even if storage deletion fails
      }
    }

    // Delete from database
    await prisma.roomTypePhoto.delete({
      where: { id: photoId },
    });

    // If this was the main photo, set another photo as main
    if (photo.isMain) {
      const nextPhoto = await prisma.roomTypePhoto.findFirst({
        where: { roomTypeId },
        orderBy: { createdAt: 'asc' },
      });

      if (nextPhoto) {
        await prisma.roomTypePhoto.update({
          where: { id: nextPhoto.id },
          data: { isMain: true },
        });
      }
    }

    return NextResponse.json({ message: 'Photo deleted successfully' });
  } catch (error) {
    console.error('Error deleting photo:', error);
    return NextResponse.json(
      { error: 'Failed to delete photo' },
      { status: 500 }
    );
  }
}

// PATCH - Set a photo as main
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ roomTypeId: string }> }
) {
  try {
    const guard = await staffGuard('inventory.write', { roomTypeId: (await params).roomTypeId });
    if ('error' in guard) return guard.error;

    const { roomTypeId } = await params;
    const body = await request.json();
    const { photoId } = body;

    if (!photoId) {
      return NextResponse.json(
        { error: 'Photo ID is required' },
        { status: 400 }
      );
    }

    // First, unset all photos as main for this room type
    await prisma.roomTypePhoto.updateMany({
      where: { roomTypeId },
      data: { isMain: false },
    });

    // Set the selected photo as main
    const updatedPhoto = await prisma.roomTypePhoto.update({
      where: { id: photoId },
      data: { isMain: true },
    });

    return NextResponse.json(updatedPhoto);
  } catch (error) {
    console.error('Error setting main photo:', error);
    return NextResponse.json(
      { error: 'Failed to set main photo' },
      { status: 500 }
    );
  }
}
