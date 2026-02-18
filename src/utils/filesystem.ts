import { Micro } from "effect"

export class BlobUrlCreationError extends Micro.TaggedError("BlobUrlCreationError")<{
	readonly message: string
	readonly cause?: Error | unknown
}> {}
export function createBinaryUrlEffect(content: BlobPart[], filename: string, contentType: string) {
	const blobUrl = Micro.try({
		try: () => {
			const blob = new Blob(content, { type: contentType })
			const url = URL.createObjectURL(blob)
			return url
		},
		catch: (error: unknown) => new BlobUrlCreationError({ message: "Failed to create blob for download", cause: error })
	})

	// const a = document.createElement('a');
	// a.href = url;
	// a.download = filename;
	// a.style.display = 'none'; // Hide the element

	// document.body.appendChild(a);
	// a.click(); // Simulate a click
	// document.body.removeChild(a);
	// URL.revokeObjectURL(url); // Clean up the object URL
	return blobUrl
}

// Example usage:
// downloadFile('Some data here', 'data.json', 'application/json');
