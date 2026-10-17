# Copilot Instructions for HotelOne Website

<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## Project Overview
This is a full-stack motel booking website built with Next.js, TypeScript, and PostgreSQL. The system includes:

- **Admin Panel**: Property management, room type management, booking management, user management
- **Customer Interface**: Property browsing, room booking, user account management
- **Authentication**: Multi-level authentication with role-based access control
- **Database**: PostgreSQL with Prisma ORM for data management

## Code Style Guidelines
- Use TypeScript for all components and utilities
- Follow React best practices with functional components and hooks
- Use Tailwind CSS for styling with consistent design patterns
- Implement proper error handling and loading states
- Use Prisma for database operations with proper type safety
- Follow REST API conventions for backend endpoints

## Architecture Patterns
- **Frontend**: Next.js App Router with server and client components
- **Backend**: API routes in Next.js with proper middleware
- **Database**: Relational design with proper foreign key relationships
- **Authentication**: JWT-based authentication with NextAuth.js
- **File Upload**: Cloudinary or similar service for image management

## Security Considerations
- Always validate input data on both client and server side
- Implement proper authentication checks for protected routes
- Use role-based access control for admin vs customer features
- Sanitize user uploads and implement proper file type validation
- Use environment variables for sensitive configuration

## Component Structure
- Create reusable UI components in `/src/components/ui/`
- Separate admin and customer components in respective directories
- Use proper TypeScript interfaces for props and data models
- Implement proper loading and error states for all components

## Database Best Practices
- Use Prisma schema with proper relationships and constraints
- Implement database migrations for schema changes
- Use transactions for complex operations like booking creation
- Index frequently queried fields for performance
- Implement soft deletes where appropriate for audit trails
