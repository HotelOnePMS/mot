import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { staffGuard } from '@/server/guard';
import { uploadImage, deleteImage } from '@/lib/cloudinary';

// POST - Upload photos to a property
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  try {
    const guard = await staffGuard('property.write', { propertyId: (await params).propertyId });
    if ('error' in guard) return guard.error;

    const { propertyId } = await params;

    // Check if property exists
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });

    if (!property) {
      return NextResponse.json(
        { error: 'Property not found' },
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
    const existingPhotosCount = await prisma.propertyPhoto.count({
      where: { propertyId }
    });

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      
      // Upload to Cloudinary
      const result = await uploadImage(image, `properties/${propertyId}`);

      // Create photo record in database
      const photo = await prisma.propertyPhoto.create({
        data: {
          propertyId,
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

// GET - Get all photos for a property
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  try {
    const guard = await staffGuard(null, { propertyId: (await params).propertyId });
    if ('error' in guard) return guard.error;

    const { propertyId } = await params;

    const photos = await prisma.propertyPhoto.findMany({
      where: { propertyId },
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
  { params }: { params: Promise<{ propertyId: string }> }
) {
  try {
    const guard = await staffGuard('property.write', { propertyId: (await params).propertyId });
    if ('error' in guard) return guard.error;

    const { searchParams } = new URL(request.url);
    const photoId = searchParams.get('photoId');

    if (!photoId) {
      return NextResponse.json(
        { error: 'Photo ID is required' },
        { status: 400 }
      );
    }

    // Find the photo
    const photo = await prisma.propertyPhoto.findUnique({
      where: { id: photoId },
    });

    if (!photo) {
      return NextResponse.json(
        { error: 'Photo not found' },
        { status: 404 }
      );
    }

    // Delete from Cloudinary
    if (photo.publicId) {
      try {
        await deleteImage(photo.publicId);
      } catch (error) {
        console.error('Error deleting from Cloudinary:', error);
        // Continue to delete from database even if Cloudinary deletion fails
      }
    }

    // Delete from database
    await prisma.propertyPhoto.delete({
      where: { id: photoId },
    });

    // If this was the main photo, set another photo as main
    if (photo.isMain) {
      const nextPhoto = await prisma.propertyPhoto.findFirst({
        where: { propertyId: (await params).propertyId },
        orderBy: { createdAt: 'asc' },
      });

      if (nextPhoto) {
        await prisma.propertyPhoto.update({
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
  { params }: { params: Promise<{ propertyId: string }> }
) {
  try {
    const guard = await staffGuard('property.write', { propertyId: (await params).propertyId });
    if ('error' in guard) return guard.error;

    const body = await request.json();
    const { photoId } = body;

    if (!photoId) {
      return NextResponse.json(
        { error: 'Photo ID is required' },
        { status: 400 }
      );
    }

    // First, unset all photos as main for this property
    await prisma.propertyPhoto.updateMany({
      where: { propertyId: (await params).propertyId },
      data: { isMain: false },
    });

    // Set the selected photo as main
    const updatedPhoto = await prisma.propertyPhoto.update({
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
